'use strict';

// Imports dependencies and set up http server
const
  express = require('express'),
  bodyParser = require('body-parser'),
  app = express().use(bodyParser.json()), // creates express http server
  crypto = require('crypto');

require('dotenv').config();
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const request = require('request');
let Wit = require('node-wit').Wit;
let log = require('node-wit').log;
//const request = require('http').request();

//heroku token
app.set(process.env.VERIFICATION_TOKEN);
console.log("Heroku Verification Token:",process.env.VERIFICATION_TOKEN);

// Sets server port and logs message on success 
app.listen(process.env.PORT || 5000, () => console.log('webhook is listening, port ',process.env.PORT));


// Wit.ai parameters
const WIT_TOKEN = process.env.WIT_ACCESS_TOKEN;

// Messenger API parameters
const FB_PAGE_TOKEN = process.env.PAGE_ACCESS_TOKEN;
if (!FB_PAGE_TOKEN) { throw new Error('missing FB_PAGE_TOKEN') }
const FB_APP_SECRET = process.env.FB_APP_SECRET;
if (!FB_APP_SECRET) { throw new Error('missing FB_APP_SECRET') }

let FB_VERIFY_TOKEN = null;
crypto.randomBytes(8, (err, buff) => {
  if (err) throw err;
  FB_VERIFY_TOKEN = buff.toString('hex');
  console.log(`/webhook will accept the Verify Token "${FB_VERIFY_TOKEN}"`);
});

// ----------------------------------------------------------------------------
// Messenger API specific code

// See the Send API reference
// https://developers.facebook.com/docs/messenger-platform/send-api-reference

const fbMessage = (id, text) => {
  const body = JSON.stringify({
    recipient: { id },
    message: { text },
  });
  const qs = 'access_token=' + encodeURIComponent(FB_PAGE_TOKEN);
  return fetch('https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
  })
  .then(rsp => rsp.json())
  .then(json => {
    if (json.error && json.error.message) {
      throw new Error(json.error.message);
    }
    return json;
  });
};

const fbMessageAttach = (id, attachment) => {
  const body = JSON.stringify({
    recipient: { id },
    message: {     
        attachment: {
            type: template,
            payload: {
              template_type: generic,
              elements: [{
                title: "Is this the right picture?",
                subtitle: "Tap a button to answer.",
                buttons: [
                  {
                    type: postback,
                    title: "Yes!",
                    payload: yes,
                  },
                  {
                    type: postback,
                    title: "No!",
                    payload: no,
                  }
                ],
              }]
            }
          }
  },
  });
  const qs = 'access_token=' + encodeURIComponent(FB_PAGE_TOKEN);
  return fetch('https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
  })
  .then(rsp => rsp.json())
  .then(json => {
    if (json.error && json.error.message) {
      throw new Error(json.error.message);
    }
    return json;
  });
};

// ----------------------------------------------------------------------------
// Wit.ai bot specific code

// This will contain all user sessions.
// Each session has an entry:
// sessionId -> {fbid: facebookUserId, context: sessionState}
const sessions = {};

const findOrCreateSession = (fbid) => {
  let sessionId;
  // Let's see if we already have a session for the user fbid
  Object.keys(sessions).forEach(k => {
    if (sessions[k].fbid === fbid) {
      // Yep, got it!
      sessionId = k;
    }
  });
  if (!sessionId) {
    // No session found for user fbid, let's create a new one
    sessionId = new Date().toISOString();
    sessions[sessionId] = {fbid: fbid, context: {}};
  }
  return sessionId;
};

// Setting up our bot
const wit = new Wit({
  accessToken: WIT_TOKEN,
  logger: new log.Logger(log.INFO)
});

// Starting our webserver and putting it all together
app.use(({method, url}, rsp, next) => {
  rsp.on('finish', () => {
    console.log(`${rsp.statusCode} ${method} ${url}`);
  });
  next();
});
app.use(bodyParser.json({ verify: verifyRequestSignature }));

// Webhook setup
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(400);
  }
});

// Message handler
app.post('/webhook', (req, res) => {
  // Parse the Messenger payload
  // See the Webhook reference
  // https://developers.facebook.com/docs/messenger-platform/webhook-reference
  const data = req.body;

  if (data.object === 'page') {
    data.entry.forEach(entry => {
      entry.messaging.forEach(event => {
        if (event.message && !event.message.is_echo) {
          // Yay! We got a new message!
          // We retrieve the Facebook user ID of the sender
          const sender = event.sender.id;

          // We could retrieve the user's current session, or create one if it doesn't exist
          // This is useful if we want our bot to figure out the conversation history
          // const sessionId = findOrCreateSession(sender);

          // We retrieve the message content
          const {text, attachments} = event.message;

          if (attachments) {
            // We received an attachment
            // Let's reply with an automatic message
            fbMessageAttach(sender, attachments);
            // fbMessage(sender, 'Sorry I can only process text messages for now.')
            // .catch(console.error);
          } else if (text) {
            // We received a text message
            // Let's run /message on the text to extract some entities
            wit.message(text).then(({entities}) => {
              // You can customize your response to these entities
              console.log(entities);
              // For now, let's reply with another automatic message
              fbMessage(sender, `We've received your message: ${text}.`);
            })
            .catch((err) => {
              console.error('Oops! Got an error from Wit: ', err.stack || err);
            })
          }
        } else {
          console.log('received event', JSON.stringify(event));
        }
      });
    });
  }
  res.sendStatus(200);
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];
  console.log(signature);

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', FB_APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}
  
  //   // Checks this is an event from a page subscription
  //   if (body.object === 'page') {
  
  //     // Iterates over each entry - there may be multiple if batched
  //     body.entry.forEach(function(entry) {
  
  //       // Gets the message. entry.messaging is an array, but 
  //       // will only ever contain one message, so we get index 0
  //       let webhook_event = entry.messaging[0];
  //       console.log(webhook_event);
        
  //       // Get the sender PSID
  //       let sender_psid = webhook_event.sender.id;
  //       console.log('Sender PSID: ' + sender_psid);

  //       // Check if the event is a message or postback and
  //       // pass the event to the appropriate handler function
  //       if (webhook_event.message) {
  //         handleMessage(sender_psid, webhook_event.message);        
  //       } else if (webhook_event.postback) {
  //         handlePostback(sender_psid, webhook_event.postback);
  //       }

  //     });
  
  //     // Returns a '200 OK' response to all requests
  //     res.status(200).send('EVENT_RECEIVED');
  //   } else {
  //     // Returns a '404 Not Found' if event is not from a page subscription
  //     res.sendStatus(404);
  //   }
  
  // });

//   // Handles messages events
//   function handleMessage(sender_psid, received_message) {
//     let response;
    
//     // Checks if the message contains text
//     if (received_message.text) {    
//       // Create the payload for a basic text message, which
//       // will be added to the body of our request to the Send API
//       response = {
//         "attachment":{
//           "type":"template",
//           "payload":{
//             "template_type":"button",
//             "text":"Make better fraud risk decisions using geolocation intelligence!",
//             "buttons":[
//               {
//                 "type":"web_url",
//                 "url":"https://developer.visa.com/capabilities/mlc/docs",
//                 "title":"Mobile Location Confirmation",
//                 "webview_height_ratio": "full"
//               }
//             ]
//           }
//         }
//         //"text": `You sent the message: "${received_message.text}". Now send me an attachment!`
//       }
//     } else if (received_message.attachments) {
//       // Get the URL of the message attachment
//       let attachment_url = received_message.attachments[0].payload.url;
//       response = {
//         "attachment": {
//           "type": "template",
//           "payload": {
//             "template_type": "generic",
//             "elements": [{
//               "title": "Is this the right picture?",
//               "subtitle": "Tap a button to answer.",
//               "image_url": attachment_url,
//               "buttons": [
//                 {
//                   "type": "postback",
//                   "title": "Yes!",
//                   "payload": "yes",
//                 },
//                 {
//                   "type": "postback",
//                   "title": "No!",
//                   "payload": "no",
//                 }
//               ],
//             }]
//           }
//         }
//       }
//     } 
//     // Send the response message
//     callSendAPI(sender_psid, response);    
//   }

// // Handles messaging_postbacks events
// function handlePostback(sender_psid, received_postback) {
//   let response;
  
//   // Get the payload for the postback
//   let payload = received_postback.payload;

//   // Set the response based on the postback payload
//   if (payload === 'yes') {
//     response = { "text": "Thanks!" }
//   } else if (payload === 'no') {
//     response = { "text": "Oops, try sending another image." }
//   }
//   // Send the message to acknowledge the postback
//   callSendAPI(sender_psid, response);

// }

// // Sends response messages via the Send API
// function callSendAPI(sender_psid, response) {
//     // Construct the message body
//     let request_body = {
//       "recipient": {
//         "id": sender_psid
//       },
//       "message": response
//     }
//     // Send the HTTP request to the Messenger Platform
//     request({
//       "uri": "https://graph.facebook.com/v2.6/me/messages",
//       "qs": { "access_token": PAGE_ACCESS_TOKEN },
//       "method": "POST",
//       "json": request_body
//     }, (err, res, body) => {
//       if (!err) {
//         console.log('message sent!')
//       } else {
//         console.error("Unable to send message:" + err);
//       }
//     }); 
// }


//   // Adds support for GET requests to our webhook
// app.get('/webhook', (req, res) => {
//     console.log('======starting GET =====');
    
//     // Your verify token. Should be a random string.
//     let VERIFY_TOKEN = PAGE_ACCESS_TOKEN;
      
//     // Parse the query params
//     let mode = req.query['hub.mode'];
//     let token = req.query['hub.verify_token'];
//     let challenge = req.query['hub.challenge'];
    
//     console.log("Webhook in verify page token method", VERIFY_TOKEN);
//     // Checks if a token and mode is in the query string of the request
//     if (mode && token) {
      
//       // Checks the mode and token sent is correct
//       if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        
//         // Responds with the challenge token from the request
//         console.log('WEBHOOK_VERIFIED');
//         res.status(200).send(challenge);
      
//       } else {
//         // Responds with '403 Forbidden' if verify tokens do not match
//         res.sendStatus(403);      
//       }
//     }
//     else
//     {
//       res.sendStatus(500).send("NULL mode or token found");
//     }
//   });
