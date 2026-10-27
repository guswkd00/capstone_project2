"use strict";

const express = require("express");
const { pool } = require("./db");
const { createManagerAIHandler } = require("./manager-ai-handler");
const {
  createConversationHandlers
} = require("./manager-ai-conversations");

const router = express.Router();
const conversations = createConversationHandlers(pool);

router.get("/conversations", conversations.list);
router.post("/conversations", conversations.create);
router.get("/conversations/:id/messages", conversations.messages);
router.delete("/conversations/:id", conversations.remove);

router.post("/chat", createManagerAIHandler({ db: pool }));

module.exports = router;
