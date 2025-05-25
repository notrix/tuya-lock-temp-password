const mqtt = require('mqtt'),
    readYaml = require('read-yaml'),
    https = require('https'),
    CryptoJS = require('crypto-js'),
    baseHost = 'openapi.tuyaeu.com',
    userAgent = 'NoTriX tuya-lock-temp-password 0.1.0';

let config;
try {
    config = readYaml.sync('config.yml');
} catch(err) {
    config = readYaml.sync('config.yml.dist');
}

let refreshTokenStr = null;

(function () {
    try {
        let mqttOptions = config.mqtt.options;
        let topicStatus = process.env.TOPIC + '/status';
        let topicSubscribe = process.env.TOPIC + '/password';
        let topicSuccess = process.env.TOPIC + '/success';
        let topicError = process.env.TOPIC + '/error';

        mqttOptions.will = {
            topic: topicStatus,
            payload: 'offline',
            retain: true,
            qos: 1
        };

        const client = mqtt.connect(config.mqtt.host, mqttOptions);
        client.on("connect", () => {
            client.subscribe(topicSubscribe, (err) => {
                if (!err) {
                    client.publish(topicStatus, 'online', {
                        retain: true,
                        qos: 1
                    });
                }
            });
        });
        client.on('message', function (topic, message) {
            let messageData = JSON.parse(message.toString());

            console.debug(messageData);
            pushTempPass(client, messageData, topicSuccess, topicError);
        });
    } catch(err) {
        console.error(err.message);
    }
})();

function pushTempPass(mqttClient, data, topicSuccess, topicError) {
    const errorCallback = function (errorMessage) {
        console.error("Error: " + errorMessage);
        mqttClient.publish(topicError, errorMessage, {
            retain: false,
            qos: 1
        });
    };

    const successCallback = function (result) {
        console.log("Success! Created temp password: " + result);
        mqttClient.publish(topicSuccess, "Created temp password: " + result, {
            retain: false,
            qos: 1
        });
    };

    const tokenCallback = function (requestResult) {
        const accessToken = requestResult.access_token;
        refreshTokenStr = requestResult.refresh_token;

        const deviceId = process.env.DEVICE;

        makeRequest(
            'GET',
            '/v1.0/devices/' + deviceId +  '/door-lock/temp-passwords',
            null,
            '',
            accessToken,
            function (devices) {
                let requestStart = new Date(data.start * 1000).toLocaleDateString();
                let requestEnd = new Date(data.end * 1000).toLocaleDateString();
                let codeExists = false;
                devices.forEach(function (device) {
                    let startDate = new Date(device.effective_time * 1000).toLocaleDateString();
                    let endDate = new Date(device.invalid_time * 1000).toLocaleDateString();

                    if (requestStart === startDate && requestEnd === endDate) {
                        codeExists = true;
                    }
                });

                if (codeExists) {
                    console.log("Code already exists! Skipping new code creation.");

                    return;
                }

                makeRequest(
                    'POST',
                    '/v1.0/devices/' + deviceId +  '/door-lock/password-ticket',
                    null,
                    '',
                    accessToken,
                    function (ticketResponse) {
                        const ticketId = ticketResponse.ticket_id;
                        const ticketKey = ticketResponse.ticket_key;

                        const secret = process.env.SECRET;
                        const ticket = decryptAES128(ticketKey, secret);

                        let payload = {
                            "password": encryptAES128(data.code, ticket),
                            "password_type": "ticket",
                            "ticket_id": ticketId,
                            "effective_time": data.start,
                            "invalid_time": data.end,
                            "name": data.name
                        };

                        makeRequest(
                            'POST',
                            '/v1.0/devices/' + deviceId +  '/door-lock/temp-password',
                            null,
                            JSON.stringify(payload),
                            accessToken,
                            function (responseBody) {
                                successCallback(data.name);
                            },
                            errorCallback
                        );
                    },
                    errorCallback
                );
            },
            errorCallback
        )
    };

    if (refreshTokenStr) {
        makeRequest(
            'GET',
            '/v1.0/token/' + refreshTokenStr,
            null,
            '',
            null,
            tokenCallback,
            errorCallback
        );

        return;
    }

    makeRequest(
        'GET',
        '/v1.0/token',
        [{"key":"grant_type","value":"1"}],
        '',
        null,
        tokenCallback,
        errorCallback
    );
}

function makeRequest(method, path, query, bodyStr, accessToken, callback, errorCallback) {
    let signMap = stringToSign(path, query, method, bodyStr);
    let urlStr = signMap["url"];
    let signStr = signMap["signUrl"];

    const timestamp = getTime();
    const clientId = process.env.CLIENT_ID;
    const secret = process.env.SECRET;

    let sign = calcSign(clientId, accessToken, timestamp, signStr, secret);

    let options = {
        hostname: baseHost,
        port: 443,
        path: urlStr,
        method: method,
        headers: {
            'client_id': clientId,
            'sign': sign,
            't': timestamp,
            'sign_method': 'HMAC-SHA256',
            'User-Agent': userAgent
        }
    }
    if (accessToken) {
        options.headers['access_token'] = accessToken;
    }
    if (bodyStr) {
        options.headers['Content-Type'] = 'application/json';
        options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    console.debug('Making request', options);

    const request = https.request(options, resp => {
        let data = "";
        resp.on("data", chunk => {
            data += chunk;
        });
        resp.on("end", () => {
            let response = JSON.parse(data);
            console.debug(response);

            if (response.success) {
                callback(response.result);
            } else {
                errorCallback("code: " + response.code + " msg: " + response.msg);
            }
        });
    }).on("error", err => {
        errorCallback("code: X msg: " + err.message);
    });

    if (bodyStr) {
        request.write(bodyStr);
    }
    request.end();
}

function getTime(){
    return new Date().getTime();
}

function encryptAES128(data, secretKey) {
    let key = CryptoJS.enc.Utf8.parse(secretKey);
    let encrypted = CryptoJS.AES.encrypt(data, key, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
    });

    return encrypted.ciphertext.toString(CryptoJS.enc.Hex);
}

function decryptAES128(data, secretKey) {
    let key = CryptoJS.enc.Utf8.parse(secretKey);
    let encryptedHexStr = CryptoJS.enc.Hex.parse(data);
    let encryptedBase64Str = CryptoJS.enc.Base64.stringify(encryptedHexStr);
    let decryptedData = CryptoJS.AES.decrypt(encryptedBase64Str, key, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
    });

    return decryptedData.toString(CryptoJS.enc.Utf8);
}

// Token verification calculation
function calcSign(clientId, accessToken, timestamp, signStr, secret) {
    let str = clientId + (accessToken || '') + timestamp + signStr;
    let hash = CryptoJS.HmacSHA256(str, secret);
    let hashInBase64 = hash.toString();

    return hashInBase64.toUpperCase();
}

// Generate signature string
function stringToSign(path, query, method, bodyStr){
    let sha256 = "";
    let url = "";
    let headersStr = "";
    let map = {};
    let arr = [];
    if (query){
        toJsonObj(query, arr, map);
    }

    sha256 = CryptoJS.SHA256(bodyStr);
    arr = arr.sort();
    arr.forEach(function(item){
        url += item + "=" + map[item] + "&";
    })
    if (url.length > 0) {
        url = url.substring(0, url.length-1);
        url = path + "?" + url;
    } else {
        url = path;
    }

    return {
        "signUrl": method + "\n" + sha256 + "\n" + headersStr + "\n" + url,
        "url": url
    };
}

function toJsonObj(params, arr, map){
    let jsonBodyStr = JSON.stringify(params);
    let jsonBody = JSON.parse(jsonBodyStr);

    jsonBody.forEach(function(item){
        arr.push(item.key);
        map[item.key] = item.value;
    });
}
