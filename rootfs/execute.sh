#!/usr/bin/with-contenv bashio

HOST=$(bashio::services mqtt "host")
USERNAME=$(bashio::services mqtt "username")
PASSWORD=$(bashio::services mqtt "password")
TOPIC=$(bashio::config "topic_namespace")

sed -e "s/\${host}/${HOST}/" -e "s/\${username}/${USERNAME}/" -e "s/\${password}/${PASSWORD}/" -e "s/\${topic}/${TOPIC}/" config.yml.dist > config.yml

node main.js
