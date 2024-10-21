var mqtt = require('mqtt'),
    readYaml = require('read-yaml');

try {
    var config = readYaml.sync('config.yml');
} catch(err) {
    config = readYaml.sync('config.yml.dist');
}

try {
    var mqttOptions = config.mqtt.options;
    var topicStatus = process.env.PORT + '/status';
    var topicSubscribe = process.env.PORT + '/password';

    console.log(process.env.CLIENT_ID);
    console.log(process.env.SECRET);

    mqttOptions.will = {
        topic: topicStatus,
        payload: 'offline',
        retain: true,
        qos: 1
    };

    client = mqtt.connect(config.mqtt.host, mqttOptions);
    client.publish(topicStatus, 'online', {
        retain: true,
        qos: 1
    });
    client.subscribe(topicSubscribe);

    client.on('message', function (topic, message) {
        var data = JSON.parse(message);

        console.log(data);
    });
} catch(err) {
    console.log(err.message);
}

