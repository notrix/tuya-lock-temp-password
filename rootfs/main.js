var mqtt = require('mqtt'),
    readYaml = require('read-yaml');

try {
    var config = readYaml.sync('config.yml');
} catch(err) {
    config = readYaml.sync('config.yml.dist');
}

try {
    var mqttOptions = config.mqtt.options;
    mqttOptions.will = {
        topic: config.topics.status,
        payload: 'offline',
        retain: true,
        qos: 1
    };

    client = mqtt.connect(config.mqtt.host, mqttOptions);
    client.publish(config.topics.status, 'online', {
        retain: true,
        qos: 1
    });
    client.subscribe(config.topics.password);

    client.on('message', function (topic, message) {
        var data = JSON.parse(message);

        console.log(data);
    });
} catch(err) {
    console.log(err.message);
}

