FROM node
MAINTAINER bence@patientsknowbest.com
RUN mkdir /opt/fake-oauth2-server
WORKDIR /opt/fake-oauth2-server
COPY . /opt/fake-oauth2-server
RUN cd /opt/fake-oauth2-server && npm install
EXPOSE 8282
ENTRYPOINT ["node" , "/opt/fake-oauth2-server/server.js" ]
