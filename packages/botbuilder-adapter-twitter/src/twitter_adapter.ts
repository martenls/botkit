/**
 * @module botbuilder-adapter-twitter
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { Activity, ActivityTypes, BotAdapter, TurnContext, ConversationReference, ResourceResponse } from 'botbuilder';
import * as Debug from 'debug';
import { TwitterBotWorker } from './botworker';
import { TwitterAPI, TwitterOAuth } from './twitter_api';
import * as crypto from 'crypto';
import { TwitterWebhookHelper } from './twitter_webhook_helper';
import { Botkit } from 'botkit';
const debug = Debug('botkit:Twitter');


/**
 * Connect [Botkit](https://www.npmjs.com/package/botkit) or [BotBuilder](https://www.npmjs.com/package/botbuilder) to Twitter.
 */
export class TwitterAdapter extends BotAdapter {
    /**
     * Name used by Botkit plugin loader
     * @ignore
     */
    public name = 'Twitter Adapter';

    /**
     * Object containing one or more Botkit middlewares to bind automatically.
     * @ignore
     */
    public middlewares;

    /**
     * A customized BotWorker object that exposes additional utility methods.
     * @ignore
     */
    public botkit_worker = TwitterBotWorker;

    private options: TwitterAdapterOptions;

    private webhookHelper: TwitterWebhookHelper;

    /**
     * Create an adapter to handle incoming messages from Twitter and translate them into a standard format for processing by your bot.
     *
     * The Twitter Adapter can only be bound to a single Twitter page
     *
     * To create an app bound to a single Twitter page, include that page's `access_token` in the options.
     *     *
     * To use with Botkit:
     * ```javascript
     * const adapter = new TwitterAdapter({
     *      verify_token: process.env.Twitter_VERIFY_TOKEN,
     *      app_secret: process.env.Twitter_APP_SECRET,
     *      access_token: process.env.Twitter_ACCESS_TOKEN
     * });
     * const controller = new Botkit({
     *      adapter: adapter,
     *      // other options
     * });
     * ```
     *
     * To use with BotBuilder:
     * ```javascript
     * const adapter = new TwitterAdapter({
     *      verify_token: process.env.Twitter_VERIFY_TOKEN,
     *      app_secret: process.env.Twitter_APP_SECRET,
     *      access_token: process.env.Twitter_ACCESS_TOKEN
     * });
     * const server = restify.createServer();
     * server.use(restify.plugins.bodyParser());
     * server.post('/api/messages', (req, res) => {
     *      adapter.processActivity(req, res, async(context) => {
     *          // do your bot logic here!
     *      });
     * });
     * ```
     *
     *```
     *
     * @param options Configuration options
     */
    public constructor(options: TwitterAdapterOptions) {
        super();

        if (!options.oauth) {
            throw new Error('Adapter must receive full oauth credentials for the bot account(access_token, access_token_secret, consumer_key, consumer_secret')
        }


        this.options = {
            api_host: 'api.twitter.com',
            api_version: '1.1',
            ...options
        };


        this.webhookHelper = new TwitterWebhookHelper(this.options.webhook_env, this.options.oauth);


        this.middlewares = {
            spawn: [
                async (bot, next) => {
                    bot.api = await this.getAPI();
                    next();
                }
            ]
        };
    }

    /**
     * Botkit-only: Initialization function called automatically when used with Botkit.
     * Adds listener on webserver to answer Twitter webhook verification challenge.
     * Subscribes to accounts activity when the webhook registration was successfull.
     * @param botkit
     */
    public async init(botkit): Promise<any> {
        debug('Add GET webhook endpoint for verification at: ', botkit.getConfig('webhook_uri'));
        // verify credentials and get user id
        this.options.user_id = (await this.webhookHelper.verifyCredentials(this.options.oauth)).id;
        // listen for crc challegen on webhook
        botkit.webserver.get(botkit.getConfig('webhook_uri'), (req, res) => {
            const crc = this.webhookHelper.validateWebhook(req.query['crc_token'], this.options.oauth)
            res.writeHead(200, {'content-type': 'application/json'});
            res.end(JSON.stringify(crc));
        });
        await this.webhookHelper.removeWebhooks();


        await this.webhookHelper.setWebhook(this.options.webhook_url? this.options.webhook_url + botkit.getConfig('webhook_uri') : botkit.getConfig('webhook_uri'), this.options.oauth, this.options.webhook_env);
        await this.webhookHelper.subscribe(this.options.oauth);

    }

    /**
     * Get a Twitter API client with the correct credentials.
     * This is used by many internal functions to get access to the Twitter API, and is exposed as `bot.api` on any BotWorker instances passed into Botkit handler functions.
     *
     * ```javascript
     * let api = adapter.getAPI(activity);
     * let res = api.callAPI('/me/messages', 'POST', message);
     * ```
     * @param activity An incoming message activity
     */
    public async getAPI(): Promise<TwitterAPI> {
        if (this.options.oauth) {
            return new TwitterAPI(this.options.oauth, this.options.api_host, this.options.api_version)
        } else {
            throw new Error('Missing credentials for page.');
        }
    }

    /**
     * Converts an Activity object to a Twitter messenger outbound message ready for the API.
     * @param activity
     */
    private activityToTwitterDM(activity: any): any {
        const message = {
            event: {
                type: 'message_create',
                message_create: {
                  target: {
                    recipient_id: activity.recipient.id,
                  },
                  message_data: {
                    text: activity.text,
                    quick_reply: null,
                    ctas: null
                  },
                }
            }
        };


        // map these fields to their appropriate place
        if (activity.channelData) {
            if (activity.channelData.quick_replies) {
                message.event.message_create.message_data.quick_reply = {
                    type: 'options',
                    options: activity.channelData.quick_replies
                }
            }
            if (activity.channelData.ctas) {
                message.event.message_create.message_data.ctas = activity.channelData.ctas;
            }
        }

        debug('OUT TO Twitter > ', message);

        return message;
    }

    private activityToTweets(activity: any): any {
        let texts = activity.text.match(/.{1,280}/g);
        return texts.map((text) => {return {
            status: text,
            in_reply_to_status_id: activity.replyToId,
            auto_populate_reply_metadata: true,
        }});
    }

    /**
     * Standard BotBuilder adapter method to send a message from the bot to the messaging API.
     * [BotBuilder reference docs](https://docs.microsoft.com/en-us/javascript/api/botbuilder-core/botadapter?view=botbuilder-ts-latest#sendactivities).
     * @param context A TurnContext representing the current incoming message and environment.
     * @param activities An array of outgoing activities to be sent back to the messaging API.
     */
    public async sendActivities(context: TurnContext, activities: Partial<Activity>[]): Promise<ResourceResponse[]> {
        const responses = [];
        for (let a = 0; a < activities.length; a++) {
            const activity = activities[a];
            if (activity.channelId == 'TwitterMention' && activity.type === ActivityTypes.Message) {
                // TODO: send TwitterMention Activity
                const messages = this.activityToTweets(activity);
                try {
                    const api = await this.getAPI(context.activity);

                    await api.postThreadReply(messages);
                } catch (err) {
                    console.error('Error sending activity to Twitter:', err);
                }
            } else if (activity.channelId == 'TwitterDM') {
                if (activity.type === ActivityTypes.Message) {
                    const message = this.activityToTwitterDM(activity);
                    try {
                        const api = await this.getAPI(context.activity);
                        const res = await api.callAPI('/direct_messages/events/new.json', 'POST', message);
                        if (res) {
                            responses.push({ id: res.message_id });
                        }
                        debug('RESPONSE FROM Twitter > ', res);
                    } catch (err) {
                        console.error('Error sending activity to Twitter:', err);
                    }
                } else if (activity.type === ActivityTypes.Typing) {
                    const message = { recipient_id: activity.recipient.id }
                    try {
                        const api = await this.getAPI(context.activity);
                        const res = await api.callAPI('/direct_messages/indicate_typing.json', 'POST', {}, message);
                        if (res) {
                            responses.push({ id: res.message_id });
                        }
                        debug('RESPONSE FROM Twitter > ', res);
                    } catch (err) {
                        console.error('Error sending activity to Twitter:', err);
                    }
                }
                
            } else {
                // If there are ever any non-message type events that need to be sent, do it here.
                debug('Unknown message type encountered in sendActivities: ', activity.type);
            }
        }

        return responses;
    }

    /**
     * Twitter adapter does not support updateActivity.
     * @ignore
     */
    // eslint-disable-next-line
    public async updateActivity(context: TurnContext, activity: Partial<Activity>): Promise<void> {
        debug('Twitter adapter does not support updateActivity.');
    }

    /**
     * Twitter adapter does not support updateActivity.
     * @ignore
     */
    // eslint-disable-next-line
     public async deleteActivity(context: TurnContext, reference: Partial<ConversationReference>): Promise<void> {
        debug('Twitter adapter does not support deleteActivity.');
    }

    /**
     * Standard BotBuilder adapter method for continuing an existing conversation based on a conversation reference.
     * [BotBuilder reference docs](https://docs.microsoft.com/en-us/javascript/api/botbuilder-core/botadapter?view=botbuilder-ts-latest#continueconversation)
     * @param reference A conversation reference to be applied to future messages.
     * @param logic A bot logic function that will perform continuing action in the form `async(context) => { ... }`
     */
    public async continueConversation(reference: Partial<ConversationReference>, logic: (context: TurnContext) => Promise<void>): Promise<void> {
        const request = TurnContext.applyConversationReference(
            { type: 'event', name: 'continueConversation' },
            reference,
            true
        );
        const context = new TurnContext(this, request);

        return this.runMiddleware(context, logic);
    }

    /**
     * Accept an incoming webhook request and convert it into a TurnContext which can be processed by the bot's logic.
     * @param req A request object from Restify or Express
     * @param res A response object from Restify or Express
     * @param logic A bot logic function in the form `async(context) => { ... }`
     */
    public async processActivity(req, res, logic: (context: TurnContext) => Promise<void>): Promise<void> {
        debug('IN FROM Twitter >', req.body);
        const event = req.body;
        if (event.tweet_create_events) {
            for (let i = 0; i < event.tweet_create_events.length; i++) {
                await this.processSingleMentionTweet(event.tweet_create_events[i], logic);
            }
        } else if (event.direct_message_events) {
            for (let i = 0; i < event.direct_message_events.length; i++) {
                await this.processSingleDM(event.direct_message_events[i], logic);
            }
        } else if (event.direct_messsage_indicate_typing_events) {
            for (let i = 0; i < event.direct_messsage_indicate_typing_events.length; i++) {
                await this.processSingleDMTypingEvent(event.direct_messsage_indicate_typing_events[i], logic);
            }
        } else if (event.direct_message_mark_read_events) {
            for (let i = 0; i < event.direct_message_mark_read_events.length; i++) {
                await this.processSingleMarkReadEvent(event.direct_message_mark_read_events[i], logic);
            }
        }

        res.status(200);
        res.end();
    
        
    }

    /**
     * Handles each individual message inside a webhook payload (webhook may deliver more than one message at a time)
     * @param message
     * @param logic
     */
    private async processSingleDM(message: any, logic: any): Promise<void> {
        // filter out messages sent by the bot
        if (message.message_create.sender_id != this.options.user_id) {
            const activity: Activity = {
                channelId: 'TwitterDM',
                timestamp: new Date(),
                // @ts-ignore ignore missing optional fields
                conversation: {
                    id: message.message_create.sender_id
                },
                from: {
                    id: message.message_create.sender_id,
                    name: message.message_create.sender_id
                },
                recipient: {
                    id: message.message_create.target.recipient_id,
                    name: message.message_create.target.recipient_id
                },
                channelData: message,
                type: ActivityTypes.Message,
                text: message.message_create.message_data.text
            };
            for (const key in message.message_create.message_data.entities) {
                activity.channelData[key] = message.message_create.message_data.entities[key];
            }

            const context = new TurnContext(this, activity as Activity);
            await this.runMiddleware(context, logic);
        }        
    }

    private async processSingleDMTypingEvent(message: any, logic: any) {
        const activity: Activity = {
            channelId: 'TwitterDM',
            timestamp: new Date(),
            // @ts-ignore ignore missing optional fields
            conversation: {
                id: message.sender_id
            },
            from: {
                id: message.sender_id,
                name: message.sender_id
            },
            recipient: {
                id: message.taget.recipient_id,
                name: message.taget.recipient_id
            },
            channelData: message,
            type: ActivityTypes.Typing
        };
        const context = new TurnContext(this, activity as Activity);
        await this.runMiddleware(context, logic);
    }

    private async processSingleMarkReadEvent(message: any, logic: any) {
        const activity: Activity = {
            channelId: 'TwitterDM',
            timestamp: new Date(),
            // @ts-ignore ignore missing optional fields
            conversation: {
                id: message.sender_id
            },
            from: {
                id: message.sender_id,
                name: message.sender_id
            },
            recipient: {
                id: message.target.recipient_id,
                name: message.target.recipient_id
            },
            channelData: message,
            type: ActivityTypes.MessageReaction
        };
        const context = new TurnContext(this, activity as Activity);
        await this.runMiddleware(context, logic);
    }

    private async processSingleMentionTweet(tweet: any, logic: any) {
        // filter out messages sent by the bot
        if (tweet.user.id != this.options.user_id) {
            const activity: Activity = {
                channelId: 'TwitterMention',
                timestamp: new Date(),
                id: tweet.id_str,
                // @ts-ignore ignore missing optional fields
                conversation: {
                    id: tweet.user.id
                },
                from: {
                    id: tweet.user.id,
                    name: tweet.user.screen_name
                },
                recipient: {
                    id: this.options.user_id,
                    name: this.options.user_id
                },
                channelData: tweet,
                type: ActivityTypes.Message,
                text: tweet.text
            };
            for (const key in tweet.entities) {
                activity.channelData[key] = tweet.entities[key];
            }

            const context = new TurnContext(this, activity as Activity);
            await this.runMiddleware(context, logic);
        }     
    }


}

/**
 * This interface defines the options that can be passed into the TwitterAdapter constructor function.
 */
export interface TwitterAdapterOptions {
    /**
     * Alternate root url used to contruct calls to Twitter's API.  Defaults to 'api.twitter.com' but can be changed (for mocking, proxy, etc).
     */
    api_host?: string;
    /**
     * Alternate API version used to construct calls to Twitter's API. Defaults to v1.1
     */
    api_version?: string;
    /**
     * Id of the bots twitter account to identify messages and tweet sent by himself.
     */
    user_id?: string;
    /**
     * Full oauth credentials of the bots twitter account.
     */
    oauth: TwitterOAuth;
    /**
     * The name 
     */
    webhook_env: string;

    webhook_url?: string;

    webhook_port?: string;

    /**
     * Allow the adapter to startup without a complete configuration.
     * This is risky as it may result in a non-functioning or insecure adapter.
     * This should only be used when getting started.
     */
    enable_incomplete?: boolean;
}
