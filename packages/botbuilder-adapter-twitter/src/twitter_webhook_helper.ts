import * as util from 'util';
import * as crypto from 'crypto';
import * as url from 'url';
import * as request from "request-promise-native";
import { TwitterError, TooManySubscriptionsError, UserSubscriptionError, WebhookURIError, RateLimitError} from './errors'
import { TwitterOAuth } from './twitter_api';


export class TwitterWebhookHelper {
    private _getSubscriptionsCount: any = null;
    private _bearerToken: string = null;
    
    private headers;
    private webhookURI;
    private env;
    private auth: TwitterOAuth;
    
    constructor(env, auth: TwitterOAuth, headers = []) {
        this.env = env;
        this.auth = auth;
        this.headers = headers;
    }
    
    private async bearerToken(auth) {
        if (this._bearerToken) {
            return this._bearerToken;
        }
        
        const requestConfig = {
            url: 'https://api.twitter.com/oauth2/token',
            auth: {
                user: auth.consumer_key,
                pass: auth.consumer_secret,
            },
            form: {
                grant_type: 'client_credentials',
            },
            resolveWithFullResponse: true,
            ...this.headers,
        };
        
        const response = await request.post(requestConfig);
        this._bearerToken = JSON.parse(response.body).access_token;
        return this._bearerToken;
    }
    
    private async getSubscriptionsCount(auth) {
        if (this._getSubscriptionsCount) {
            return this._getSubscriptionsCount;
        }
        
        const token = await this.bearerToken(auth);
        const requestConfig = {
            url: 'https://api.twitter.com/1.1/account_activity/all/subscriptions/count.json',
            auth: { bearer: token },
            resolveWithFullResponse: true,
            ...this.headers,
        };
        
        const response = await request.get(requestConfig);
        
        switch (response.statusCode) {
            case 200:
            break;
            case 429:
            throw new RateLimitError(response);
            break;
            default:
            throw new TwitterError(response);
        }
        
        this._getSubscriptionsCount = JSON.parse(response.body);
        return this._getSubscriptionsCount;
    }
    
    private updateSubscriptionCount(increment) {
        if (!this._getSubscriptionsCount) {
            return;
        }
        
        this._getSubscriptionsCount.subscriptions_count += increment;
    }
    
    
    private async getWebhooks(auth, env) {
        console.log('Getting webhooks…');
        const token = await this.bearerToken(auth);
        const requestConfig = {
            url: `https://api.twitter.com/1.1/account_activity/all/${env}/webhooks.json`,
            oauth: auth,
            resolveWithFullResponse: true,
            ...this.headers,
        };
        
        const response = await request.get(requestConfig);
        switch (response.statusCode) {
            case 200:
            break;
            case 429:
            throw new RateLimitError(response);
            return [];
            default:
            throw new URIError([
                `Cannot get webhooks. Please check that '${env}' is a valid environment defined in your`,
                `Developer dashboard at https://developer.twitter.com/en/account/environments, and that`,
                `your OAuth credentials are valid and can access '${env}'. (HTTP status: ${response.statusCode})`].join(' '));
                return [];
            }
            
            try {
                return JSON.parse(response.body);
            } catch (e) {
                throw TypeError('Error while parsing the response from the Twitter API:' + e.message);
                return [];
            }
    }
        
    public async setWebhook(webhookUrl, auth: TwitterOAuth, env) { 
        const parsedUrl = url.parse(webhookUrl);
        if (parsedUrl.protocol === null || parsedUrl.host === 'null') {
            throw new TypeError(`${webhookUrl} is not a valid URL. Please provide a valid URL and try again.`);
            return;
        } else if (parsedUrl.protocol !== 'https:') {
            throw new TypeError(`${webhookUrl} is not a valid URL. Your webhook must be HTTPS.`);
            return;
        }
        
        console.log(`Registering ${webhookUrl} as a new webhook…`);
        const endpoint = new url.URL(`https://api.twitter.com/1.1/account_activity/all/${env}/webhooks.json`);
        endpoint.searchParams.append('url', webhookUrl);
        
        const requestConfig = {
            url: endpoint.toString(),
            oauth: auth,
            resolveWithFullResponse: true,
            ...this.headers,
        }
        
        const response = await request.post(requestConfig);
        
        switch (response.statusCode) {
            case 200:
            case 204:
            break;
            case 400:
            case 403:
            throw new WebhookURIError(response);
            return null;
            case 429:
            console.log(response.headers);
            throw new RateLimitError(response);
            return null;
            default:
            throw new URIError([
                `Cannot get webhooks. Please check that '${env}' is a valid environment defined in your`,
                `Developer dashboard at https://developer.twitter.com/en/account/environments, and that`,
                `your OAuth credentials are valid and can access '${env}'. (HTTP status: ${response.statusCode})`].join(' '));
                return null;
            }
            
            const body = JSON.parse(response.body);
            return body;
        }
        
            
            
            
        public validateWebhook(token, auth: TwitterOAuth) {
            const responseToken = crypto.createHmac('sha256', auth.consumer_secret).update(token).digest('base64');
            return { response_token: `sha256=${responseToken}` };
        }
        
        public async verifyCredentials(auth: TwitterOAuth) {
            const requestConfig = {
                url: 'https://api.twitter.com/1.1/account/verify_credentials.json',
                oauth: auth,
                resolveWithFullResponse: true,
                ...this.headers
            };
            
            const response = await request.get(requestConfig);
            if (response.statusCode === 200) {
                return JSON.parse(response.body);
            } else {
                throw new UserSubscriptionError(response);
                return null;
            }
        }
        

        private async deleteWebhooks(webhooks, auth: TwitterOAuth, env) {
            console.log('Removing webhooks…');
            for (const {id, url} of webhooks) {
                const requestConfig = {
                    url: `https://api.twitter.com/1.1/account_activity/all/${env}/webhooks/${id}.json`,
                    oauth: auth,
                    resolveWithFullResponse: true,
                    ...this.headers,
                }
                
                console.log(`Removing ${url}…`);
                const response = await request.del(requestConfig);
                
                switch (response.statusCode) {
                    case 200:
                    case 204:
                    return true;
                    case 429:
                    throw new RateLimitError(response);
                    return false;
                    default:
                    throw new URIError([
                        `Cannot remove ${url}. Please make sure it belongs to '${env}', and that '${env}' is a`,
                        `valid environment defined in your Developer dashboard at`,
                        `https://developer.twitter.com/en/account/environments. Also check that your OAuth`,
                        `credentials are valid and can access '${env}'. (HTTP status: ${response.statusCode})`,
                    ].join(' '));
                    return false;
                }
            }
        }
        
        public async removeWebhooks() {
            const webhooks = await this.getWebhooks(this.auth, this.env);
            await this.deleteWebhooks(webhooks, this.auth, this.env);
        }
        
        
        public async subscribe(auth: TwitterOAuth) {       
            try {
                var user = await this.verifyCredentials(auth);
            } catch (e) {
                throw e;
                return false;
            }
            const {subscriptions_count, provisioned_count} = await this.getSubscriptionsCount(auth);
            
            if (subscriptions_count === provisioned_count) {
                throw new TooManySubscriptionsError([`Cannot subscribe to ${user.screen_name}'s activities:`,
                'you exceeded the number of subscriptions available to you.',
                'Please remove a subscription or upgrade your premium access at',
                'https://developer.twitter.com/apps.',
            ].join(' '));
            return false;
            }
            
            const requestConfig = {
                url: `https://api.twitter.com/1.1/account_activity/all/${this.env}/subscriptions.json`,
                oauth: auth,
                resolveWithFullResponse: true,
                ...this.headers,
            };
            
            const response = await request.post(requestConfig);
            if (response.statusCode === 204) {
                console.log(`Subscribed to ${user.screen_name}'s activities.`);
                this.updateSubscriptionCount(1);
                return true;
            } else {
                throw new UserSubscriptionError(response);
                return false;
            }
        }
        
        private async unsubscribe(userId) {
            const token = await this.bearerToken(this.auth);
            const requestConfig = {
                url: `https://api.twitter.com/1.1/account_activity/all/${this.env}/subscriptions/${userId}.json`,
                auth: { bearer: token },
                resolveWithFullResponse: true,
            };
            
            const response = await request.del(requestConfig);
            
            if (response.statusCode === 204) {
                console.log(`Unsubscribed from ${userId}'s activities.`);
                this.updateSubscriptionCount(-1);
                return true;
            } else {
                throw new UserSubscriptionError(response);
                return false;
            }
        }
        
        
        
        
        
        
        
        
        
    }