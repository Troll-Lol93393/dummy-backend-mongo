import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
    const key = process.env.EMAIL_ENCRYPTION_KEY;
    if (!key || key.length < 32) {
        throw new Error(
            "EMAIL_ENCRYPTION_KEY must be set in environment variables (min 32 characters)"
        );
    }
    // Use first 32 bytes of the key
    return Buffer.from(key.slice(0, 32), "utf-8");
}

export function encryptPassword(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
}

export function decryptPassword(ciphertext: string): string {
    const [ivHex, encrypted] = ciphertext.split(":");
    if (!ivHex || !encrypted) {
        throw new Error("Invalid encrypted password format");
    }
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
