import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { getEmailSettings } from "../models/emailSettings.model";
import { decryptPassword } from "./emailEncryption";

let otpTransporter: nodemailer.Transporter | null = null;

function getOtpTransporter(): nodemailer.Transporter {
    if (!otpTransporter) {
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            throw new Error(
                "SMTP credentials not configured. Set SMTP_USER and SMTP_PASS in your .env file."
            );
        }
        otpTransporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: Number(process.env.SMTP_PORT) || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }
    return otpTransporter;
}

export interface SendMailAddress {
    name: string;
    address: string;
}

export interface SendMailOptions {
    to: string | SendMailAddress[];
    cc?: string | SendMailAddress[];
    subject: string;
    html: string;
    inReplyTo?: string;
    references?: string[];
}

export interface SendMailResult {
    messageId: string;
    raw: Buffer;
}

/**
 * A reply must go out from the mailbox that received the request so the
 * customer's reply-to-the-reply threads back into the synced inbox — fall
 * back to IMAP credentials when SMTP-specific ones aren't set, since most
 * setups here use one Gmail account for both inbound sync and outbound send.
 */
export async function getSmtpCredentials(): Promise<{
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    fromName: string;
    replySignatureHtml: string;
}> {
    const settings = await getEmailSettings();
    const user = settings.smtpUser || settings.imapUser;
    const encryptedPassword = settings.smtpPassword || settings.imapPassword;

    if (!user || !encryptedPassword) {
        throw new Error(
            "Outbound email is not configured — set SMTP or IMAP credentials in Email Settings."
        );
    }

    return {
        host: settings.smtpHost || "smtp.gmail.com",
        port: settings.smtpPort || 587,
        secure: settings.smtpSecure ?? false,
        user,
        password: decryptPassword(encryptedPassword),
        fromName: settings.fromName || "",
        replySignatureHtml: settings.replySignatureHtml || "",
    };
}

/**
 * Generic send, separate from sendOtpEmail below. This is the only path used
 * for customer-facing replies (threaded via inReplyTo/references).
 */
export async function sendMail(options: SendMailOptions): Promise<SendMailResult> {
    const creds = await getSmtpCredentials();
    const transport = nodemailer.createTransport({
        host: creds.host,
        port: creds.port,
        secure: creds.secure,
        auth: { user: creds.user, pass: creds.password },
    });

    const from = creds.fromName ? `"${creds.fromName}" <${creds.user}>` : creds.user;

    // Build via MailComposer first so we have the exact raw MIME that was sent —
    // callers use this to append the same message into the mailbox's Sent
    // folder over IMAP, which nodemailer's SMTP transport doesn't do itself.
    const node = new MailComposer({
        from,
        to: options.to,
        cc: options.cc,
        subject: options.subject,
        html: options.html,
        inReplyTo: options.inReplyTo,
        references: options.references,
    }).compile();

    const raw = await node.build();
    const messageId = node.messageId();

    await transport.sendMail({ raw, envelope: node.getEnvelope() });

    return { messageId, raw };
}

export async function sendOtpEmail(to: string, otp: string): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 0;">
        <tr>
            <td align="center">
                <table width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
                    <!-- Header -->
                    <tr>
                        <td style="background-color:#1a1a2e;padding:28px 32px;text-align:center;">
                            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;letter-spacing:0.5px;">Password Reset</h1>
                        </td>
                    </tr>
                    <!-- Body -->
                    <tr>
                        <td style="padding:32px;">
                            <p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.6;">
                                We received a request to reset your password. Use the OTP below to proceed:
                            </p>
                            <!-- OTP Box -->
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center" style="padding:20px 0;">
                                        <div style="display:inline-block;background-color:#f0f4ff;border:2px dashed #4a6cf7;border-radius:8px;padding:16px 40px;">
                                            <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#1a1a2e;">${otp}</span>
                                        </div>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin:16px 0 0;color:#666;font-size:13px;line-height:1.6;text-align:center;">
                                This OTP is valid for <strong>15 minutes</strong>. Do not share it with anyone.
                            </p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="background-color:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;">
                            <p style="margin:0;color:#999;font-size:12px;text-align:center;line-height:1.5;">
                                If you didn't request a password reset, you can safely ignore this email.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    await getOtpTransporter().sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject: "Password Reset OTP",
        html,
    });
}
