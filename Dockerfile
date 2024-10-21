ARG BUILD_FROM
FROM $BUILD_FROM

ENV LANG C.UTF-8

COPY rootfs /

WORKDIR /

RUN apk add --no-cache --virtual .build-dependencies \
        g++ \
        gcc \
        libc-dev \
        linux-headers \
        make

RUN apk add nodejs npm

RUN npm install --no-audit --no-optional --no-update-notifier --only=production

RUN chmod a+x /execute.sh

CMD [ "/execute.sh" ]
