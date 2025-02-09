const ContextService = require('./services/ContextService.js');
const SlackService = require('./services/SlackService.js');
const LuisService = require('./services/LuisService.js');
const DBService = require('./services/DBService.js');
const Utils = require('./services/Utils.js');
const async = require('asyncawait/async');
const await = require('asyncawait/await');
const requireDir = require('require-dir');
const IntentHandlers = requireDir('./intentHandlers');
const thrw = require('throw');
const https = require('https');
const AWS = require("aws-sdk");
const lambda = new AWS.Lambda({
  region: "ap-southeast-2",
  maxRetries: 0
});

const client = {
	id: process.env.CLIENT_ID,
	secret: process.env.CLIENT_SECRET,
	botID: process.env.SLACK_BOT_ID
};

module.exports.install = (event, context, callback) => {
	callback(null, {
		statusCode: 200,
		headers: {
			'Content-Type': 'text/html'
		},
		body: Utils.installHTML(client.id)
	});
};

module.exports.authorized = (event, context, callback) => {
	const code = event.queryStringParameters.code;

	https.get(`https://slack.com/api/oauth.access?client_id=${client.id}&client_secret=${client.secret}&code=${code}`, response => {
		var body = '';
		response.on('data', chunk => body += chunk);
		response.on('end', () => {
			const jsonBody = JSON.parse(body);
			DBService.storeAccessToken(jsonBody.team_id, jsonBody.bot.bot_access_token)
				.catch(error => console.log(error));
		});
	});

	callback(null, {
		statusCode: 200,
		headers: {
			'Content-Type': 'text/html'
		},
		body: Utils.authorizedHTML()
	});
};

// receptionist Lambda responds to url_verification requests
// or passes request onto event Lambda and immediately returns
// a HTTP 200 response.
module.exports.receptionist = (event, context, callback) => {
    // interactive Slack messages are URL encoded so they need to be decoded in the event body before parsing
    event.body = event.body.startsWith("payload") ? decodeURIComponent(event.body.substring(8)) : event.body;
    const jsonBody = JSON.parse(event.body);

    // print debugging information to AWS Cloudwatch
    if (jsonBody.type === "interactive_message"){
        console.log("All: " + JSON.stringify(jsonBody));
    }else if (jsonBody.type !== 'url_verification'){
        console.log("Text: " + JSON.stringify(jsonBody.event.text));
        console.log("Event: " + JSON.stringify(jsonBody.event));
        console.log("All: " + JSON.stringify(jsonBody));
    }

    // we don't want to respond to Slack HTTP timeout retries
    var timeoutRetry = false;
    if (event.headers['X-Slack-Retry-Reason']
        && event.headers['X-Slack-Retry-Reason'] === 'http_timeout'){
        console.log("Slack timed out and sent a retry");
        timeoutRetry = true;
    }

    const response = {
        statusCode: 200
    };
    if (jsonBody.type === 'url_verification'){
        response.headers = {
            'Content-Type': 'application/x-www-form-urlencoded'
        };
        response.body = jsonBody.challenge;
    // respond to bot mentions and interactive message callbacks from Slack. Ignore http_timeout retries
    } else if (( jsonBody.type === "interactive_message" || jsonBody.event.text.includes(`@${client.botID}`) ) && !timeoutRetry){
        // asynchronously call event Lambda
        lambda.invoke({
            FunctionName: 'poet-bot-dev-event',
            InvocationType: 'Event',
            Payload: JSON.stringify(event, null, 2)
            }, function(error, data) {
            if (error) {
                console.log("Invoke error: " + error);
//                context.done('error', error);
            }
            if(data.Payload){
                console.log("Invoke success: " + data.Payload);
                context.succeed(data.Payload)
            }
        });
    } else if (!timeoutRetry) {
        // ignore bot messages
        if (!jsonBody.event.subtype || jsonBody.event.subtype !== 'bot_message'){
            ContextService.maintainContextIssueID(jsonBody.event.text, jsonBody.event.channel);
        }
    }

    callback(null, response);
};

// event Lambda calls Luis and palms execution off to intended intent handler
module.exports.event = async ((event, context, callback) => {
    const jsonBody = JSON.parse(event.body);
    if (jsonBody.type === 'event_callback'){
        // retrieve the bot access token from the DynamoDB
        const botAccessToken = await (DBService.retrieveAccessToken(jsonBody.team_id)
            .catch(error => console.log(error)));
    	if (jsonBody.event.type === 'message'){
            // ignore ourselves
            if (!jsonBody.event.subtype || jsonBody.event.subtype !== 'bot_message') {
                // call Luis
                const response = await (LuisService.interpretQuery(jsonBody.event.text.replace(`<@${client.botID}>`, ''))
                    .catch(error => {
                        console.log("LuisCatchErr: " + error);
                    }));

                handleIntent(response, jsonBody.event, botAccessToken);
            }
    	}
	}else if (jsonBody.type === 'interactive_message'){
	    // retrieve the bot access token from the DynamoDB
	    const botAccessToken = await (DBService.retrieveAccessToken(jsonBody.team.id)
            .catch(error => console.log(error)));
        handleInteractiveCallbacks(jsonBody, botAccessToken);
	}
});

// report error or call the JIRA handler function based on Luis response
const handleIntent = async ((response, event, token) => {
    console.log("LUIS: " + JSON.stringify(response));
    // catch LUIS call errors
    if (response.statusCode >= 300){
        SlackService.postError(`Luis Error: ${response.statusCode} - ${response.message}`, event.channel, token);
        return;
    }

    const intent = response.topScoringIntent.intent;

    // hand off execution to intended handler and handle missing entity errors
    if (intent in IntentHandlers){
        try{
            await (IntentHandlers[intent].process(event, token, response.entities));
        }catch(error){
            console.log("handleIntent: " + error + error.stack);
            SlackService.postError(error.message, event.channel, token);
        }
    }else{
        SlackService.postError("I understand you, but that feature hasn't been implemented yet! Go slap the developer (into action)! :raised_hand_with_fingers_splayed: ", event.channel, token);
    }
});

const handleInteractiveCallbacks = (event, token) => {
    console.log(`interactive callback for ${event.callback_id}`);
    // hand off execution to intended handler
    if (event.callback_id in IntentHandlers){
        try{
            await (IntentHandlers[event.callback_id].interactiveCallback(event, token));
        }catch(error){
            console.log("handleInteractiveCallbacks: " + error + error.stack);
            SlackService.postError(error.message, event.channel.id, token);
        }
    }else{
        SlackService.postError(`Interactive callback incorrectly configured. '${event.callback_id}' does not exist in 'IntentHandlers'`, event.channel.id, token);
    }
};