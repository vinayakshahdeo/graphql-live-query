import * as tinyhttpApp from "@tinyhttp/app";
import * as tinyhttpLogger from "@tinyhttp/logger";
import socketIO from "socket.io";
import * as net from "net";
import * as graphqlSchema from "./graphql/schema";
import * as fakeData from "./fakeData";

import { registerGraphQLLayer } from "./registerGraphQLLayer";
import { UserStore } from "./user-store";
import { SimpleLiveQueryStore } from "@n1ru4l/graphql-live-query-simple-store";
import { MessageStore } from "./message-store";
import { PubSub } from "graphql-subscriptions";

const app = new tinyhttpApp.App();

const parsePortSafe = (port: string) => {
  const parsedPort = parseInt(port, 10);
  if (Number.isNaN(parsedPort)) {
    return 3000;
  }
  return parsedPort;
};

const server = app
  .use(tinyhttpLogger.logger())
  .use("/", (req, res) => res.send("Hello World."))
  .listen(parsePortSafe(process.env.PORT || "3001"));

const socketServer = socketIO(server);

const subscriptionPubSub = new PubSub();
const liveQueryStore = new SimpleLiveQueryStore();
const userStore = new UserStore();
const messageStore = new MessageStore();

for (let i = 0; i < 10; i++) {
  const user = fakeData.createFakeUser();
  userStore.add(user);
  // messageStore.add(fakeData.createFakeMessage(user.id));
}

// lets add some new users randomly
// setInterval(() => {
//   userStore.add(fakeData.createFakeUser());
//   liveQueryStore.triggerUpdate("Query.users");
// }, 10000).unref();

// lets add some new messages randomly
setInterval(() => {
  // all live queries that select Query.users will receive an update.
  const user = userStore.getRandom();
  if (user) {
    messageStore.add(fakeData.createFakeMessage(user.id));
    liveQueryStore.triggerUpdate("Query.messages");
    subscriptionPubSub.publish("onNewMessage", true);
  }
}, 5000).unref();

// Lets change some messages randomly
// setInterval(() => {
//   // all live queries that select Query.users will receive an update.
//   // const user = userStore.getRandom();
//   // if (user) {
//   const message = messageStore.getLast();
//   if (message) {
//     // messageStore.delete(message.id);
//     message.content = fakeData.randomSentence();
//     liveQueryStore.triggerUpdate("Query.messages");
//   }
//   // }
// }, 2000).unref();

registerGraphQLLayer({
  socketServer,
  schema: graphqlSchema.schema,
  liveQueryStore,
  createContext: () => ({
    userStore,
    messageStore,
    liveQueryStore,
    subscriptionPubSub,
  }),
});

const connections = new Set<net.Socket>();
server.on("connection", (connection) => {
  connections.add(connection);
  connection.on("close", () => {
    connections.delete(connection);
  });
});

let isShuttingDown = false;

process.on("SIGINT", () => {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  server.close();
  socketServer.close();
  for (const connection of connections) {
    connection.destroy();
  }
});
