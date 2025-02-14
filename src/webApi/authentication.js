'use strict';
const QueryString = require('querystring');
const fs = require('fs');
const fsPromises = fs.promises;
const axios = require('axios');
const CONSTANTS = require('../constans.json');

class AUTHENTICATION {
    constructor(config) {
        this.webApiClientId = config.webApiClientId || CONSTANTS.WebApi.ClientId;
        this.webApiClientSecret = config.webApiClientSecret;
        this.tokensFile = config.tokensFile;
        this.tokens = {
            oauth: {},
            user: {},
            xsts: {}
        };
    }

    refreshTokens(type) {
        return new Promise(async (resolve, reject) => {
            switch (type) {
                case 'user':
                    if (this.tokens.user.Token) {
                        const tokenExpired = new Date() > new Date(this.tokens.user.NotAfter).getTime();
                        switch (tokenExpired) {
                            case true:
                                try {
                                    await this.refreshToken(this.tokens.oauth.refresh_token);
                                    await this.getUserToken(this.tokens.oauth.access_token);
                                    await this.refreshTokens('xsts');
                                    resolve();
                                } catch (error) {
                                    reject(error);
                                };
                                break;
                            case false:
                                try {
                                    await this.refreshTokens('xsts');
                                    resolve();
                                } catch (error) {
                                    reject(error);
                                };
                                break;
                        }
                    } else {
                        try {
                            await this.getUserToken(this.tokens.oauth.access_token);
                            await this.refreshTokens('xsts');
                            resolve();
                        } catch (error) {
                            reject(error);
                        };
                    }
                    break;
                case 'xsts':
                    if (this.tokens.xsts.Token) {
                        const tokenExpired = new Date() > new Date(this.tokens.xsts.NotAfter).getTime();
                        switch (tokenExpired) {
                            case true:
                                try {
                                    await this.getXstsToken(this.tokens.user.Token);
                                    await this.refreshTokens('xsts');
                                    resolve();
                                } catch (error) {
                                    reject(error);
                                };
                                break;
                            case false:
                                resolve();
                                break;
                        }
                    } else {
                        try {
                            await this.getXstsToken(this.tokens.user.Token);
                            resolve();
                        } catch (error) {
                            reject(error);
                        };
                    }
                    break;
                default:
                    reject(`Unknow refresh token type: ${type}.`);
                    break;
            }
        })
    }

    refreshToken(token) {
        return new Promise(async (resolve, reject) => {
            try {
                const payload = {
                    "client_id": this.webApiClientId,
                    "grant_type": "refresh_token",
                    "scope": CONSTANTS.WebApi.Scopes,
                    "refresh_token": token,
                }
                const addClientSecret = this.webApiClientSecret ? payload.client_secret = this.webApiClientSecret : false;

                const postData = QueryString.stringify(payload);
                const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
                const response = await axios.post(CONSTANTS.WebApi.Url.RefreshToken, postData, headers);
                const refreshToken = response.data;
                refreshToken.issued = new Date().toISOString();
                this.tokens.oauth = refreshToken;
                resolve();
            } catch (error) {
                reject(error);
            };
        })
    }

    getUserToken(accessToken) {
        return new Promise(async (resolve, reject) => {
            try {
                const payload = {
                    "RelyingParty": 'http://auth.xboxlive.com',
                    "TokenType": 'JWT',
                    "Properties": {
                        "AuthMethod": 'RPS',
                        "SiteName": 'user.auth.xboxlive.com',
                        "RpsTicket": `d=${accessToken}`
                    },
                }

                const postData = JSON.stringify(payload);
                const headers = { 'Content-Type': 'application/json' };
                const response = await axios.post(CONSTANTS.WebApi.Url.UserToken, postData, { headers });
                const userToken = response.data;
                this.tokens.user = userToken;
                this.tokens.xsts = {};
                resolve();
            } catch (error) {
                reject(error);
            };
        })
    }

    getXstsToken(userToken) {
        return new Promise(async (resolve, reject) => {
            try {
                const payload = {
                    "RelyingParty": 'http://xboxlive.com',
                    "TokenType": 'JWT',
                    "Properties": {
                        "UserTokens": [userToken],
                        "SandboxId": 'RETAIL',
                    },
                }

                const postData = JSON.stringify(payload);
                const headers = { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' };
                const response = await axios.post(CONSTANTS.WebApi.Url.XstsToken, postData, headers);
                const xstsToken = response.data;
                this.tokens.xsts = xstsToken;
                resolve();
            } catch (error) {
                reject(error);
            };
        })
    }

    accessToken(webApiToken) {
        return new Promise(async (resolve, reject) => {
            try {
                const payload = {
                    "client_id": this.webApiClientId,
                    "grant_type": 'authorization_code',
                    "scope": CONSTANTS.WebApi.Scopes,
                    "code": webApiToken,
                    "redirect_uri": CONSTANTS.WebApi.Url.Redirect
                }
                const addClientSecret = this.webApiClientSecret ? payload.client_secret = this.webApiClientSecret : false;

                const postData = QueryString.stringify(payload);
                const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
                const response = await axios.post(CONSTANTS.WebApi.Url.AccessToken, postData, headers);
                const accessToken = response.data;
                accessToken.issued = new Date().toISOString();
                this.tokens.oauth = accessToken;
                await this.saveTokens(this.tokens);
                resolve();
            } catch (error) {
                reject(error);
            };
        })
    }

    checkAuthorization() {
        return new Promise(async (resolve, reject) => {
            if (this.webApiClientId) {
                try {
                    const tokens = await this.readTokens();
                    this.tokens = !tokens ? this.tokens : tokens;

                    if (this.tokens.oauth.refresh_token) {
                        await this.refreshTokens('user');
                        await this.saveTokens(this.tokens);
                        resolve({ headers: `XBL3.0 x=${this.tokens.xsts.DisplayClaims.xui[0].uhs};${this.tokens.xsts.Token}`, tokens: this.tokens });
                    } else {
                        reject('No oauth token found. Use authorization manager first.')
                    }
                } catch (error) {
                    reject(error);
                };
            } else {
                reject(`Authorization not possible, check plugin settings - Client Id: ${this.webApiClientId}`);
            }
        })
    }

    generateAuthorizationUrl() {
        return new Promise(async (resolve, reject) => {
            try {
                const payload = {
                    "client_id": this.webApiClientId,
                    "response_type": 'code',
                    "approval_prompt": 'auto',
                    "scope": CONSTANTS.WebApi.Scopes,
                    "redirect_uri": CONSTANTS.WebApi.Url.Redirect
                }
                const params = QueryString.stringify(payload);
                const oauth2URI = `${CONSTANTS.WebApi.Url.oauth2}?${params}`;
                resolve(oauth2URI);
            } catch (error) {
                reject(error);
            };
        })
    }

    readTokens() {
        return new Promise(async (resolve, reject) => {
            try {
                const data = await fsPromises.readFile(this.tokensFile);
                const tokens = data.length > 0 ? JSON.parse(data) : false;
                resolve(tokens);
            } catch (error) {
                reject(error);
            };
        })
    }

    saveTokens(tokens) {
        return new Promise(async (resolve, reject) => {
            try {
                tokens = JSON.stringify(tokens, null, 2);
                await fsPromises.writeFile(this.tokensFile, tokens);
                resolve();
            } catch (error) {
                reject(error);
            };
        })
    }

    clearTokens() {
        return new Promise(async (resolve, reject) => {
            try {
                const tokens = JSON.stringify({
                    oauth: {},
                    user: {},
                    xsts: {}
                }, null, 2);
                await fsPromises.writeFile(this.tokensFile, tokens);
                resolve();
            } catch (error) {
                reject(error);
            };
        })
    }
}
module.exports = AUTHENTICATION;