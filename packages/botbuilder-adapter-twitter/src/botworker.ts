/**
 * @module botbuilder-adapter-twitter
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { Botkit, BotWorker } from 'botkit';
import { TwitterAPI } from './twitter_api';

/**
 * This is a specialized version of [Botkit's core BotWorker class](core.md#BotWorker) that includes additional methods for interacting with Twitter.
 * It includes all functionality from the base class, as well as the extension methods below.
 *
 * When using the TwitterAdapter with Botkit, all `bot` objects passed to handler functions will include these extensions.
 */
export class TwitterBotWorker extends BotWorker {
    /**
     * A copy of the twitterAPI client giving access to `let res = await bot.api.callAPI(path, method, parameters);`
     */
    public api: TwitterAPI;

    /**
     * Reserved for use internally by Botkit's `controller.spawn()`, this class is used to create a BotWorker instance that can send messages, replies, and make other API calls.
     *
     * When used with the twitterAdapter's multi-tenancy mode, it is possible to spawn a bot instance by passing in the twitter page ID representing the appropriate bot identity.
     * Use this in concert with [startConversationWithUser()](#startConversationWithUser) and [changeContext()](core.md#changecontext) to start conversations
     * or send proactive alerts to users on a schedule or in response to external events.
     *
     * ```javascript
     * let bot = await controller.spawn(twitter_PAGE_ID);
     * ```
     * @param botkit The Botkit controller object responsible for spawning this bot worker.
     * @param config Normally, a DialogContext object.  Can also be the ID of a twitter page managed by this app.
     */
    public constructor(botkit: Botkit, config: any) {
        // allow a page id to be passed in
        if (typeof config === 'string') {
            const page_id = config;
            config = {
                // an activity is required to spawn the bot via the api
                activity: {
                    channelId: 'twitter',
                    recipient: {
                        id: page_id
                    }
                }
            };
        }

        super(botkit, config);
    }

    // TODO: Typing indicators

    /**
     * Change the operating context of the worker to begin a conversation with a specific user.
     * After calling this method, any calls to `bot.say()` or `bot.beginDialog()` will occur in this new context.
     *
     * This method can be used to send users scheduled messages or messages triggered by external events.
     * ```javascript
     * let bot = await controller.spawn(twitter_PAGE_ID);
     * await bot.startConversationWithUser(twitter_USER_PSID);
     * await bot.say('Howdy human!');
     * ```
     *
     * @param userId the PSID of a user the bot has previously interacted with
     */
    public async startConversationWithUser(userId): Promise<void> {
        return this.changeContext({
            channelId: 'twitter',
            // @ts-ignore
            conversation: { id: userId },
            bot: this.getConfig('activity').recipient,
            // @ts-ignore
            user: { id: userId }
        });
    }
}
