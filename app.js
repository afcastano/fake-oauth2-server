"use strict";

const express = require("express");
const morgan = require("morgan");
const fs = require("fs");
const _ = require("underscore");
const session = require("express-session");
const randomstring = require("randomstring");
const bodyParser = require("body-parser");

const ui = _.template(fs.readFileSync("./input.html").toString());

const app = express();
app.use(morgan(":method :url :status Authorization: :req[authorization] Debug info: :res[x-debug] Redirect: :res[location]"));
app.use(bodyParser.urlencoded({ extended: false }));

const EXPECTED_CLIENT_ID = process.env.EXPECTED_CLIENT_ID || "dummy-client-id";
const EXPECTED_CLIENT_SECRET = process.env.EXPECTED_CLIENT_SECRET || "dummy-client-secret";
const AUTH_REQUEST_PATH = process.env.AUTH_REQUEST_PATH || "/o/oauth2/v2/auth";
const ACCESS_TOKEN_REQUEST_PATH = process.env.ACCESS_TOKEN_REQUEST_PATH || "/oauth2/v4/token";
const USERINFO_REQUEST_URL = process.env.USERINFO_REQUEST_URL || "/oauth2/v3/userinfo";
const TOKENINFO_REQUEST_URL = process.env.TOKENINFO_REQUEST_URL || "/oauth2/v3/tokeninfo";
const PERMITTED_REDIRECT_URLS = process.env.PERMITTED_REDIRECT_URLS ? process.env.PERMITTED_REDIRECT_URLS.split(",") : ["http://localhost:8181/auth/login"];

const code2token = {};
const refresh2personData = {};
const authHeader2personData = {};
const id_token2personData = {};


function now() {
  return Math.round(new Date().valueOf() / 1000);
}

function errorMsg(descr, expected, actual) {
  return "expected " + descr + ": " + expected + ", actual: " + actual;
}

function validateClientId(actualClientId, res) {
  if (actualClientId === EXPECTED_CLIENT_ID) {
    return true;
  }
  res.writeHead(400, {
    "X-Debug": errorMsg("client_id", EXPECTED_CLIENT_ID, actualClientId)
  });
  res.end();
  return false;
}

function permittedRedirectURLs() {
    return _.reduce(PERMITTED_REDIRECT_URLS, (a, b) => a === "" ? b : a + ", " + b, "" );
}

function validateAuthRequest(req, res) {
  const actualClientId = req.query.client_id;
  if (validateClientId(actualClientId, res)) {
    if (req.query.response_type !== "code") {
      res.writeHead(401, {
        "X-Debug": errorMsg("response_type", "code", req.query.response_type)
      });
      return false;
    }
    if (req.query.redirect_uri && ! _.contains(PERMITTED_REDIRECT_URLS, req.query.redirect_uri)) {
      res.writeHead(401, {
        "X-Debug" : errorMsg("redirect_uri", "one of " + permittedRedirectURLs(), req.query.redirect_uri)
      });
      return false;
    }
    return true;
  }
  return false;
}

function validateAuthorizationHeader(header, res) {
  header = header.trim();
  if (!header.startsWith("Basic ")) {
    return false;
  }
  header = header.substring("Basic ".length).trim();
  const decoded = new Buffer(header, "base64").toString("ascii");
  if (decoded === "") {
    return false;
  }
  const segments = decoded.split(":");
  if (segments.length != 2) {
    return false;
  }
  if (segments[0] !== EXPECTED_CLIENT_ID) {
    return false;
  }
  if (segments[1] !== EXPECTED_CLIENT_SECRET) {
    return false;
  }
  return true;
}

function validateAccessTokenRequest(req, res) {
  console.log("Validate access token");
  let success = true, msg;
  if (req.body.grant_type !== "authorization_code" && req.body.grant_type !== "refresh_token") {
    success = false;
    msg = errorMsg("grant_type", "authorization_code or refresh_token", req.body.grant_type);
  }
  if (req.body.grant_type === "refresh_token") {
    let personData = refresh2personData[req.body.refresh_token];
    if (personData === undefined) {
      success = false;
      msg = "invalid refresh token";
    }
  }
  // if (!validateClientId(req.query.client_id, res)) {
  //   success = false;
  // }
  // if (!validateAuthorizationHeader(req.headers["authorization"])) {
  //   success = false;
  //   msg = errorMsg("Authorization header", req.headers["authorization"], "Basic ZHVtbXktY2xpZW50LWlkOmR1bW15LWNsaWVudC1zZWNyZXQ=");
  // }
  // if (!validateClientId(req.body.client_id, res)) {
  //   success = false;
  //   msg = errorMsg("client_id", EXPECTED_CLIENT_ID, req.body.client_id);
  // } else if (req.body.client_secret !== EXPECTED_CLIENT_SECRET) {
  //   success = false;
  //   msg = errorMsg("client_secret", EXPECTED_CLIENT_SECRET, req.body.client_secret);
  // } else if (req.session.redirect_uri !== req.body.redirect_uri) {
  //   success = false;
  //   msg = errorMsg("redirect_uri", req.session.redirect_uri, req.body.redirect_uri);
  // }
  // if (!success) {
  //   console.log("validateAccessTokenRequest  unsuccessful");
  //   const params = {};
  //   if (msg) {
  //     console.log("Debug msg " + msg);
  //     params["X-Debug"] = msg;
  //   }
  //   res.writeHead(401, params);
  // }
  return success;
}

function createToken(name, email, expires_in, client_state) {
  const code = "C-" + randomstring.generate(3);
  const accesstoken = "ACCT-" + randomstring.generate(6);
  const refreshtoken = "REFT-" + randomstring.generate(6);
  const id_token = "IDT-" + randomstring.generate(6);
  const token = {
    access_token: accesstoken,
    expires_in: expires_in,
    refresh_token: refreshtoken,
    id_token: id_token,
    state: client_state,
    token_type: "Bearer"
  };
  id_token2personData[id_token] = authHeader2personData["Bearer " + accesstoken] = {
    email: email,
    email_verified: true,
    name: name
  };
  code2token[code] = token;
  refresh2personData[refreshtoken] = {
    name: name,
    email: email,
    expires_in: expires_in
  };
  return code;
}

app.use(session({
  secret: "keyboard cat",
  resave: false,
  saveUninitialized: true,
  cookie: {secure: false}
}))

function authRequestHandler(req, res) {
  console.log("Auth request handler: " + JSON.stringify(req.query));
  console.log("Auth request handler header: " + JSON.stringify(req.headers));
  if (validateAuthRequest(req, res)) {
    req.session.redirect_uri = req.query.redirect_uri;
    if (req.query.state) {
      req.session.client_state = req.query.state;
    }
    res.send(ui({
      query: req.query
    }));
  } else {
    console.log('authRequestHandler Unsuccesful');
  }
  res.end();
}

app.get(AUTH_REQUEST_PATH, authRequestHandler);

app.get("/login-as", (req, res) => {
  const code = createToken(req.query.name, req.query.email, req.query.expires_in, req.session.client_state);
  if (req.session.redirect_uri) {
    let redirectUri = req.session.redirect_uri;
    let location = `${redirectUri}${redirectUri.includes('?') ? '&' : '?'}code=${code}`;
    if (req.session.client_state) {
      location += "&state=" + req.session.client_state;
    }
    res.writeHead(307, {"Location": location});
    res.end();
  }
});

app.post(ACCESS_TOKEN_REQUEST_PATH, (req, res) => {
  console.log("Access token request: " + JSON.stringify(req.body));
  console.log("Access token request headers: " + JSON.stringify(req.headers));
  if (validateAccessTokenRequest(req, res)) {
    let code = null;
    if (req.body.grant_type === "refresh_token") {
      const refresh = req.body.refresh_token;
      const personData = refresh2personData[refresh];
      code = createToken(personData.name, personData.email, personData.expires_in, null);
      delete refresh2personData[refresh];
    } else {
      code = req.body.code;
    }
    const token = code2token[code];
    if (token !== undefined) {
      console.log("access token response body: ", token);
      res.send(token);
    }
  }
  res.end();
});

app.get(USERINFO_REQUEST_URL, (req, res) => {
  console.log("User info request " + JSON.stringify(req.headers));
  const token_info = authHeader2personData[req.headers["authorization"]];
  if (token_info !== undefined) {
    console.log("userinfo response", token_info);
    res.send(token_info);
  } else {
    res.status(404);
  }
  res.end();
});

app.get(TOKENINFO_REQUEST_URL, (req, res) => {
  console.log("Token info request " + JSON.stringify(req.query));
  if (req.query.id_token == null) {
      res.status(400)
      res.send("missing id_token query parameter");
  }
  const token_info = id_token2personData[req.query.id_token];
  if (token_info !== undefined) {
    res.status(200);
    res.send(token_info);
  } else {
    res.status(404);
    res.send("token not found by id_token " + req.query.id_token);
  }
  res.end();
});


module.exports = {
  app: app,
  validateClientId: validateClientId,
  validateAccessTokenRequest: validateAccessTokenRequest,
  validateAuthorizationHeader: validateAuthorizationHeader,
  validateAuthRequest: validateAuthRequest,
  authRequestHandler: authRequestHandler,
  EXPECTED_CLIENT_ID: EXPECTED_CLIENT_ID,
  EXPECTED_CLIENT_SECRET: EXPECTED_CLIENT_SECRET,
  AUTH_REQUEST_PATH : AUTH_REQUEST_PATH,
  ACCESS_TOKEN_REQUEST_PATH : ACCESS_TOKEN_REQUEST_PATH,
  PERMITTED_REDIRECT_URLS : PERMITTED_REDIRECT_URLS,
  permittedRedirectURLs: permittedRedirectURLs,
  USERINFO_REQUEST_URL: USERINFO_REQUEST_URL
};
