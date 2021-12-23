import { Application, Request, Response } from "express";
import { base64decode, corsWithCredentialsMiddleware, sha256, stripUuid } from "../util";
import { IAccountDocument, MineSkinError } from "../typings";
import { Account } from "../database/schemas";
import { debug, warn } from "../util/colors";

export const register = (app: Application) => {

    app.use("/hiatus", corsWithCredentialsMiddleware);

    app.post("/hiatus/launch", (req, res) => {
        const auth = getAuth(req);
        console.info(debug("[Hiatus] Launch " + auth.uuid + " " + auth.modVersion));

        Account.findOne({
            enabled: true,
            uuid: auth.uuid,
            'hiatus.enabled': true
        }).then(account => {
            if (!account) {
                res.json({
                    success: false,
                    msg: "Account not found or hiatus disabled"
                });
                return;
            }
            if (!validateAuth(req, res, auth, account)) return;


            account.hiatus!.lastLaunch = Math.floor(Date.now() / 1000);
            account.save().then(() => {
                res.json({
                    success: true,
                    msg: "launch updated"
                })
            });
        })
    });

    app.post("/hiatus/exit", (req, res) => {
        const auth = getAuth(req);
        console.info(debug("[Hiatus] Exit " + auth.uuid + " " + auth.modVersion))

        Account.findOne({
            enabled: true,
            uuid: auth.uuid,
            'hiatus.enabled': true
        }).then(account => {
            if (!account) {
                res.json({
                    success: false,
                    msg: "Account not found or hiatus disabled"
                });
                return;
            }
            if (!validateAuth(req, res, auth, account)) return;

            //TODO: maybe

            account.save().then(() => {
                res.json({
                    success: true,
                    msg: ""
                })
            })
        })
    });

    app.post("/hiatus/ping", (req, res) => {
        const auth = getAuth(req);
        console.info(debug("[Hiatus] Ping " + auth.uuid + " " + auth.modVersion))

        Account.findOne({
            enabled: true,
            uuid: auth.uuid,
            'hiatus.enabled': true
        }).then(account => {
            if (!account) {
                res.json({
                    success: false,
                    msg: "Account not found or hiatus disabled"
                });
                return;
            }
            if (!validateAuth(req, res, auth, account)) return;

            account.hiatus!.lastPing = Math.floor(Date.now() / 1000);
            account.save().then(() => {
                res.json({
                    success: true,
                    msg: "ping updated"
                })
            })
        })
    });

    function getAuth(req: Request): HiatusAuth {
        const agentHeader = req.header('User-Agent');
        if (!agentHeader || agentHeader.length < 1) throw new MineSkinError("invalid user-agent header");
        const authHeader = req.header('Authorization');
        console.log(authHeader)
        if (!authHeader || authHeader.length < 1 || !authHeader.startsWith('Bearer')) throw new MineSkinError("invalid auth header");
        const split = base64decode(authHeader.substring("Bearer ".length, authHeader.length)).split(":");
        if (split.length !== 3) throw new MineSkinError("invalid auth header");
        console.log(split);

        return {
            version: parseInt(split[0]),
            uuid: stripUuid(split[1]),
            hashedEmailAndToken: split[2],
            modVersion: agentHeader
        };
    }


    function validateAuth(req: Request, res: Response, auth: HiatusAuth, account: IAccountDocument): boolean {
        if (account.uuid !== auth.uuid) {
            res.json({
                success: false,
                msg: "uuid mismatch"
            });
            console.warn(warn("[Hiatus] UUID mismatch (" + account.uuid + "!=" + auth.uuid + ")"))
            return false;
        }
        if (!account.hiatus) return false;
        const expectedHash = sha256(account.email! + ":" + account.hiatus!.token!);
        console.log("expected hash: " + expectedHash);
        console.log("actual hash:   " + auth.hashedEmailAndToken);
        if (expectedHash !== auth.hashedEmailAndToken) {
            res.json({
                success: false,
                msg: "hash mismatch"
            });
            return false;
        }

        return true;
    }

};

interface HiatusAuth {
    version: number;
    uuid: string;
    hashedEmailAndToken: string;
    modVersion: string;
}
