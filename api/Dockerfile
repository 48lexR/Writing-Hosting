FROM ubuntu:latest

RUN apt-get update && apt-get install -y npm

WORKDIR /srv/
COPY ./package/ .

RUN npm ci
CMD ["node", "app.js"]
