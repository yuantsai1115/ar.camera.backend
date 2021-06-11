'use strict';

const uuid = require('uuid');
const AWS = require('aws-sdk')

// the following section injects the new ApiGatewayManagementApi service
// into the Lambda AWS SDK, otherwise you'll have to deploy the entire new version of the SDK

/* START ApiGatewayManagementApi injection */
const { Service, apiLoader } = AWS

const dynamoDb = new AWS.DynamoDB.DocumentClient();

apiLoader.services['apigatewaymanagementapi'] = {}

const model = {
    metadata: {
        apiVersion: '2018-11-29',
        endpointPrefix: 'execute-api',
        signingName: 'execute-api',
        serviceFullName: 'AmazonApiGatewayManagementApi',
        serviceId: 'ApiGatewayManagementApi',
        protocol: 'rest-json',
        jsonVersion: '1.1',
        uid: 'apigatewaymanagementapi-2018-11-29',
        signatureVersion: 'v4'
    },
    operations: {
        PostToConnection: {
            http: {
                requestUri: '/@connections/{connectionId}',
                responseCode: 200
            },
            input: {
                type: 'structure',
                members: {
                    Data: {
                        type: 'blob'
                    },
                    ConnectionId: {
                        location: 'uri',
                        locationName: 'connectionId'
                    }
                },
                required: ['ConnectionId', 'Data'],
                payload: 'Data'
            }
        }
    },
    paginators: {},
    shapes: {}
}

AWS.ApiGatewayManagementApi = Service.defineService('apigatewaymanagementapi', ['2018-11-29'])
Object.defineProperty(apiLoader.services['apigatewaymanagementapi'], '2018-11-29', {
    // eslint-disable-next-line
    get: function get() {
        return model
    },
    enumerable: true,
    configurable: true
})
/* END ApiGatewayManagementApi injection */

module.exports.connect = (event, context, callback) => {
    console.log(event);
    // console.log(context);
    // console.log(event.requestContext);
    let modelId = event.queryStringParameters? (event.queryStringParameters.mid || "fake model id") : "fake model id";
    let deviceType = event.queryStringParameters? (event.queryStringParameters.device || 0) : 0;
    const params = {
        TableName: process.env.SNAPSHOT_TABLE,
        Item: {
            id: event.requestContext.connectionId, //uuid.v1(),
            connectionid: event.requestContext.connectionId,
            modelid: modelId,
            device: deviceType
        },
    };

    // write Websocket connectionid to the database
    dynamoDb.put(params, (error) => {
        // handle potential errors
        if (error) {
            console.error(error);
            callback(null, {
                statusCode: error.statusCode || 501,
                headers: { 'Content-Type': 'text/plain' },
                body: 'Couldn\'t connect websocket.',
            });
            return;
        }

        // create a response
        const response = {
            statusCode: 200,
            body: JSON.stringify(params.Item),
        };
        callback(null, response);
    });
};

module.exports.disconnect = (event, context, callback) => {
    const params = {
        TableName: process.env.SNAPSHOT_TABLE,
        Key: {
            id: event.requestContext.connectionId,
        },
    };
    console.log(`Start disconnecting: ${event.requestContext.connectionId}`);
    // delete connection from the database
    dynamoDb.delete(params, (error) => {
        // handle potential errors
        if (error) {
            console.error(error);
            callback(null, {
                statusCode: error.statusCode || 501,
                headers: { 'Content-Type': 'text/plain' },
                body: 'Couldn\'t delete connection id',
            });
            return;
        }
        console.log(`Delete connection: ${event.requestContext.connectionId}`);
        // create a response
        const response = {
            statusCode: 200,
            body: `Disconnected: ${event.requestContext.connectionId}.`,
        };
        callback(null, response);
    });
};

module.exports.default = async (event, context, callback) => {
    console.log(event);

    const client = new AWS.ApiGatewayManagementApi({
        apiVersion: '2018-11-29',
        endpoint: `https://${event.requestContext.domainName}/${event.requestContext.stage}`
    });
    let params = {
        TableName: process.env.SNAPSHOT_TABLE
    };
    if(JSON.parse(event.body).modelId){
        params['FilterExpression'] = "#modelid = :modelid";
        params['ExpressionAttributeNames'] = {"#modelid": "modelid"};
        params['ExpressionAttributeValues'] = {":modelid": JSON.parse(event.body).modelId};
    }
    // fetch all todos from the database
    dynamoDb.scan(params, (error, result) => {
        // handle potential errors
        if (error) {
            console.error(error);
            callback(null, {
                statusCode: error.statusCode || 501,
                headers: { 'Content-Type': 'text/plain' },
                body: 'Couldn\'t fetch the connections.',
            });
            return;
        }
        console.log(result.Items);
        result.Items.forEach(async (connection) => {
            console.log("Connection " + connection.connectionid);
            if(event.requestContext.connectionId!=connection.connectionid){
                await client
                .postToConnection({
                    ConnectionId: connection.connectionid,
                    Data: `${event.body}`
                })
                .promise();
            }
        });
    });

    callback(null, {
        statusCode: 200,
        body: 'Sent.'
    });
};

module.exports.auth = async (event, context) => {
    // return policy statement that allows to invoke the connect function.
    // in a real world application, you'd verify that the header in the event
    // object actually corresponds to a user, and return an appropriate statement accordingly
    return {
        "principalId": "user",
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Action": "execute-api:Invoke",
                    "Effect": "Allow",
                    "Resource": event.methodArn
                }
            ]
        }
    };
};