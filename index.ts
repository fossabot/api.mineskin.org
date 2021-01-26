import * as Sentry from "@sentry/node";
import * as Tracing from "@sentry/tracing";
import * as path from "path";
import * as fs from "fs";
import { Config } from "./types/Config";
import * as express from "express";
import { ErrorRequestHandler, Express, NextFunction } from "express";
import { Puller } from "express-git-puller";
import connectToMongo from "./database/database";
import RotatingFileStream from "rotating-file-stream";
import * as morgan from "morgan";
import * as bodyParser from "body-parser";
import * as fileUpload from "express-fileupload";
import * as session from "express-session";
import { RateLimit } from "express-rate-limit";
import Optimus from "optimus-js";
import { apiRequestsMiddleware, info, metrics } from "./util";
import * as rateLimit from "express-rate-limit";
import { generateRoute, getRoute, renderRoute, testerRoute, utilRoute, accountManagerRoute } from "./routes";
import { generateLimiter } from "./util/rateLimiters";
import { MOJ_DIR, Temp, UPL_DIR, URL_DIR } from "./generator/Temp";
import { MineSkinError } from "./types";
import { Time } from "@inventivetalent/loading-cache";


const config: Config = require("./config");
const port = process.env.PORT || config.port || 3014;

let updatingApp = true;

console.log("\n" +
    "  ==== STARTING UP ==== " +
    "\n");

const app: Express = express();


async function init() {

    {
        console.log("Creating temp directories");
        try {
            fs.mkdirSync(URL_DIR);
        } catch (e) {
        }
        try {
            fs.mkdirSync(UPL_DIR);
        } catch (e) {
        }
        try {
            fs.mkdirSync(MOJ_DIR);
        } catch (e) {
        }
    }

    {
        console.log("Initializing Sentry")
        Sentry.init({
            dsn: config.sentry.dsn,
            integrations: [
                new Sentry.Integrations.Http({ tracing: true }),
                new Tracing.Integrations.Express({ app })
            ],
            serverName: config.server,
            tracesSampleRate: 0.05
        });

        app.use(Sentry.Handlers.requestHandler());
        app.use(Sentry.Handlers.tracingHandler());
    }

    {
        console.log("Creating logger")

        // create a rotating write stream
        const accessLogStream = RotatingFileStream('access.log', {
            interval: '1d', // rotate daily
            path: path.join(__dirname, 'log'),
            compress: "gzip"
        });

        // setup the logger
        app.use(morgan('combined', { stream: accessLogStream }))
        morgan.token('remote-addr', (req, res): string => {
            return req.headers['x-real-ip'] as string || req.headers['x-forwarded-for'] as string || req.connection.remoteAddress || "";
        });


    }


    {
        console.log("Setting up express middleware")

        app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            if (req.method === 'OPTIONS') {
                res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE, PUT");
                res.header("Access-Control-Allow-Headers", "X-Requested-With, Accept, Content-Type, Origin");
                res.header("Access-Control-Request-Headers", "X-Requested-With, Accept, Content-Type, Origin");
                return res.sendStatus(200);
            } else {
                return next();
            }
        });
        app.use(session({
            secret: config.sessionSecret,
            cookie: {
                maxAge: Time.minutes(10)
            }
        }))
        app.use(bodyParser.urlencoded({ extended: true, limit: '50kb' }));
        app.use(bodyParser.json({ limit: '20kb' }));
        app.use(fileUpload());
        app.use((req, res, next) => {
            res.header("X-MineSkin-Server", config.server || "default");
            next();
        });
        app.use(apiRequestsMiddleware);

        app.use("/.well-known", express.static(".well-known"));
    }

    {// Git Puller
        console.log("Setting up git puller");

        const puller = new Puller(config.puller);
        puller.on("before", (req, res) => {
            updatingApp = true;
        });
        app.use(function (req, res, next) {
            if (updatingApp) {
                res.status(503).send({ err: "app is updating" });
                return;
            }
            next();
        });
        app.use(config.puller.endpoint, puller.middleware);
    }

    {
        console.log("Connecting to database")
        await connectToMongo(config);
    }

    {
        console.log("Registering routes");

        app.get("/", function (req, res) {
            res.json({ msg: "Hi!" });
        });

        generateRoute.register(app);
        getRoute.register(app);
        renderRoute.register(app);
        accountManagerRoute.register(app);
        testerRoute.register(app);
        utilRoute.register(app);

    }

    app.use(Sentry.Handlers.errorHandler());
    const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
        if (err instanceof MineSkinError) {
            if (err.httpCode) {
                res.status(err.httpCode);
            } else {
                res.status(500);
            }
            res.json({
                success: false,
                errorCode: err.code,
                error: err.msg
            });
        } else {
            res.status(500).json({
                success: false,
                error: "An unexpected error occurred"
            })
        }
    }
    app.use(errorHandler);
}


init().then(() => {
    setTimeout(() => {
        console.log("Starting app");
        app.listen(port, function () {
            console.log(info(" ==> listening on *:" + port + "\n"));
            setTimeout(() => {
                updatingApp = false;
                console.log(info("Accepting connections."));
            }, 1000);
        });
    }, 1000);
});

