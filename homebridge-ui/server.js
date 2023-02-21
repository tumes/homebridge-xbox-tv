"use strict";

const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');
const QueryString = require('querystring');
const Authentication = require('../src/webApi/authentication.js')
const fs = require('fs');
const fsPromises = fs.promises;

class PluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    this.data = {};

    // clear token
    this.onRequest('/clearToken', this.clearToken.bind(this));

    // clear token
    this.onRequest('/queryString', this.queryString.bind(this));

    // start console authorization
    this.onRequest('/startAuthorization', this.startAuthorization.bind(this));

    // this MUST be called when you are ready to accept requests
    this.ready();
  };

  async clearToken(payload) {
    try {
      const host = payload.host;
      const authTokenFile = `${this.homebridgeStoragePath}/xboxTv/authToken_${host.split('.').join('')}`;
      await fsPromises.writeFile(authTokenFile, JSON.stringify({}));
      return true;
    } catch (e) {
      throw new RequestError('Clear token file failed.', {
        message: e.message
      });
    };
  };

  async queryString(locationHash) {
    try {
      const urlParams = QueryString.parse(locationHash);
      return urlParams;
    } catch (e) {
      throw new RequestError('Query string failed.', {
        message: e.message
      });
    };
  };

  async startAuthorization(payload) {

    try {
      const host = payload.host;
      const webApiToken = payload.webApiToken;
      const authTokenFile = `${this.homebridgeStoragePath}/xboxTv/authToken_${host.split('.').join('')}`;

      const authConfig = {
        clientId: payload.clientId,
        clientSecret: payload.clientSecret,
        userToken: payload.userToken,
        uhs: payload.uhs,
        tokensFile: authTokenFile
      }
      const authentication = new Authentication(authConfig);

      try {
        await authentication.isAuthenticated();
        this.data = {
          info: 'Console already authorized. To start a new athorization process you need clear the Web API Token first.',
          status: 0
        };
      } catch (error) {
        if (webApiToken) {
          try {
            await authentication.getTokenRequest(webApiToken);
            this.data = {
              info: 'Console successfully authorized and token file saved.',
              status: 2
            };
          } catch (error) {
            this.data = {
              info: error,
              status: 3
            };
          };
        } else {
          try {
            const oauth2URI = await authentication.generateAuthorizationUrl();
            this.data = {
              info: oauth2URI,
              status: 1
            };
          } catch (error) {
            this.data = {
              info: error,
              status: 3
            };
          };
        };
      };

      return this.data;
    } catch (e) {
      throw new RequestError('Failed to return data try again.', {
        message: e.message
      });
    };
  };
};

(() => {
  return new PluginUiServer();
})();
