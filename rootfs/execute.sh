#!/usr/bin/with-contenv bashio

HOST=$(bashio::services mqtt "host")
USERNAME=$(bashio::services mqtt "username")
PASSWORD=$(bashio::services mqtt "password")

CLIENT_ID=$(bashio::config "client_id")
SECRET=$(bashio::config "secret")

sed -e "s/\${host}/${HOST}/" -e "s/\${username}/${USERNAME}/" -e "s/\${password}/${PASSWORD}/" config.yml.dist > config.yml

TOPIC=$(bashio::config "topic") node main.js
