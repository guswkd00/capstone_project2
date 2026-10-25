"use strict";

const express = require("express");
const { pool } = require("./db");
const {
  createManagerAIHandler
} = require("./manager-ai-handler");

const router = express.Router();

router.post(
  "/chat",
  createManagerAIHandler({ db: pool })
);

module.exports = router;
