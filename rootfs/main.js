const mqtt = require('mqtt'),
    readYaml = require('read-yaml'),
    https = require('https'),
    CryptoJS = require('crypto-js'),
    baseHost = 'openapi.tuyaeu.com',
    userAgent = 'NoTriX tuya-lock-temp-password 0.0.5';

let config;
try {
    config = readYaml.sync('config.yml');
} catch(err) {
    config = readYaml.sync('config.yml.dist');
}

var refreshTokenStr = null;

(function () {
    try {
        var mqttOptions = config.mqtt.options;
        var topicStatus = process.env.TOPIC + '/status';
        var topicSubscribe = process.env.TOPIC + '/password';
        var topicSuccess = process.env.TOPIC + '/success';
        var topicError = process.env.TOPIC + '/error';

        mqttOptions.will = {
            topic: topicStatus,
            payload: 'offline',
            retain: true,
            qos: 1
        };

        client = mqtt.connect(config.mqtt.host, mqttOptions);
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
            var messageData = JSON.parse(message.toString());

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

    const successCallback = function (id) {
        console.log("Success! Created temp password with id: " + id);
        mqttClient.publish(topicSuccess, "Created temp password with id: " + id, {
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
                                successCallback(responseBody.id);
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
    var signMap = stringToSign(path, query, method, bodyStr);
    var urlStr = signMap["url"];
    var signStr = signMap["signUrl"];

    const timestamp = getTime();
    const clientId = process.env.CLIENT_ID;
    const secret = process.env.SECRET;

    var sign = calcSign(clientId, accessToken, timestamp, signStr, secret);

    var options = {
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
    var key = CryptoJS.enc.Utf8.parse(secretKey);
    var encrypted = CryptoJS.AES.encrypt(data, key, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
    });

    return encrypted.ciphertext.toString(CryptoJS.enc.Hex);
}

function decryptAES128(data, secretKey) {
    var key = CryptoJS.enc.Utf8.parse(secretKey);
    var encryptedHexStr = CryptoJS.enc.Hex.parse(data);
    var encryptedBase64Str = CryptoJS.enc.Base64.stringify(encryptedHexStr);
    var decryptedData = CryptoJS.AES.decrypt(encryptedBase64Str, key, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
    });

    return decryptedData.toString(CryptoJS.enc.Utf8);
}

// Token verification calculation
function calcSign(clientId, accessToken, timestamp, signStr, secret) {
    var str = clientId + (accessToken || '') + timestamp + signStr;
    var hash = CryptoJS.HmacSHA256(str, secret);
    var hashInBase64 = hash.toString();

    return hashInBase64.toUpperCase();
}

// Generate signature string
function stringToSign(path, query, method, bodyStr){
    var sha256 = "";
    var url = "";
    var headersStr = "";
    var map = {};
    var arr = [];
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
    var jsonBodyStr = JSON.stringify(params);
    var jsonBody = JSON.parse(jsonBodyStr);

    jsonBody.forEach(function(item){
        arr.push(item.key);
        map[item.key] = item.value;
    });
}
