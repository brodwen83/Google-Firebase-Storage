const functions = require("firebase-functions");
const { Storage } = require("@google-cloud/storage");
const os = require("os");
const path = require("path");
const spawn = require("child-process-promise").spawn;
const cors = require("cors")({ origin: true });
const Busboy = require("busboy");
const fs = require("fs");

const storage = new Storage({
    projectId: functions.config().googlefirebasestorage.id,
    keyFilename: "./config/path/to/serviceAccountKey.json"
});

exports.onFileChange = functions.storage
    .object()
    .onFinalize((object, context) => {
        const bucket = object.bucket;
        const contentType = object.contentType;
        const filePath = object.name;
        console.log("File change detected, function execution started");

        if (object.resourceState === "not_exists") {
            console.log("We deleted a file, exit...");
            return;
        }

        if (path.basename(filePath).startsWith("resized-")) {
            console.log("We already renamed that file!");
            return;
        }

        const destBucket = storage.bucket(bucket);
        const tmpFilePath = path.join(os.tmpdir(), path.basename(filePath));
        const metadata = { contentType: contentType };

        return destBucket
            .file(filePath)
            .download({
                destination: tmpFilePath
            })
            .then(() => {
                return spawn("convert", [
                    tmpFilePath,
                    "-resize",
                    "500x500",
                    tmpFilePath
                ]);
            })
            .then(() => {
                return destBucket.upload(tmpFilePath, {
                    destination: "resized-" + path.basename(filePath),
                    metadata: metadata
                });
            });
    });

exports.uploadFile = functions.https.onRequest((req, res) => {
    cors(req, res, () => {
        if (req.method !== "POST") {
            return res.status(500).json({ message: "Not allowed" });
        }

        const busboy = new Busboy({ headers: req.headers });
        let uploadData = null;

        busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
            const filepath = path.join(os.tmpdir(), filename);
            uploadData = { file: filepath, type: mimetype };
            file.pipe(fs.createWriteStream(filepath));
        });

        busboy.on("finish", () => {
            const bucket = storage.bucket(
                functions.config().googlefirebasestorage.bucket
            );
            bucket
                .upload(uploadData.file, {
                    uploadType: "media",
                    metadata: {
                        metadata: {
                            contentType: uploadData.type
                        }
                    }
                })
                .then(() => {
                    res.status(200).json({
                        message: "upload success!"
                    });
                })
                .catch(err => {
                    res.status(500).send({
                        message: "error during upload",
                        err
                    });
                });
        });
        busboy.end(req.rawBody);
    });
});
