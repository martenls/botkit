/**
 * @module botbuilder-adapter-twitter
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import * as request from 'request';
import * as crypto from 'crypto';

/**
 * A simple API client for the Twitter API.  Automatically signs requests with the access token and app secret proof.
 * It can be used to call any API provided by Twitter.
 *
 */
export class TwitterAPI {
    private oauth: TwitterOAuth;
    private api_host: string;
    private api_version: string;

    /**
     * Create a TwitterAPI client.
     * ```
     * let api = new TwitterAPI(TOKEN, SECRET);
     * await api.callAPI('/some/api','POST', {some_options});
     * ```
     * @param oauth the oAuth credentials generated in the Twitter developer portal
     * @param api_host optional root hostname for constructing api calls, defaults to graph.Twitter.com
     * @param api_version optional api version used when constructing api calls, defaults to v3.2
     */
    public constructor(oauth: TwitterOAuth, api_host = 'api.twitter.com', api_version = '1.1') {
        if (!oauth) {
            throw new Error('Authentication is required!');
        }

        this.oauth = oauth;

        this.api_host = api_host;
        this.api_version = api_version;
    }

    /**
     * Call one of the Twitter APIs
     * @param path Path to the API endpoint, for example `/direct_messages/events/new.json`
     * @param method HTTP method, for example POST, GET, DELETE or PUT.
     * @param payload An object to be sent as parameters to the API call.
     */
    public async callAPI(path: string, method = 'POST', payload: any = {}, form?: any): Promise<any> {

        let queryString = '?';
        let body = {};

        if (method.toUpperCase() === 'GET') {
            for (const key in payload) {
                queryString = queryString + `${ encodeURIComponent(key) }=${ encodeURIComponent(payload[key]) }&`;
            }
        } else {
            body = payload;
        }

        return new Promise((resolve, reject) => {
            request({
                method: method.toUpperCase(),
                oauth: this.oauth,
                json: true,
                body,
                form: form,
                uri: `https://${ this.api_host }/${ this.api_version }${ path }${ queryString }`
            }, (err, res, body) => {
                if (err) {
                    reject(err);
                } else if (body && body.error) {
                    reject(body && body.error.message);
                } else {
                    resolve(body);
                }
            });
        });
    }


    

    public async postThreadReply(payloads: any[]) {
        let in_reply_to_id = payloads[0].in_reply_to_status_id;
        for (let i = 0; i < payloads.length; i++) {
            payloads[i].in_reply_to_status_id = in_reply_to_id;
            const res = await this.callAPI('/statuses/update.json', 'POST', {}, payloads[i]);
            in_reply_to_id = res.id_str
        }
    }

    
}


export interface TwitterOAuth {
    
    token: string;

    token_secret: string;

    consumer_key: string;

    consumer_secret: string;
}