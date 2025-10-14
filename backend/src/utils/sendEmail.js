const nodemailer = require('nodemailer');

/**
 * Sends an email using nodemailer.
 * The transport is configured using environment variables.
 *
 * @param {object} options - Email options.
 * @param {string} options.to - The recipient's email address.
 * @param {string} options.subject - The subject of the email.
 * @param {string} options.html - The HTML body of the email.
 */
const sendEmail = async (options) => {
    // 1. Create a transporter object using SMTP transport.
    // We are using Gmail as an example. For production, consider a transactional
    // email service like SendGrid, Mailgun, or AWS SES.
    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: process.env.EMAIL_PORT === '465', // true for 465, false for other ports
        auth: {
            user: process.env.EMAIL_USER, // Your Gmail address
            pass: process.env.EMAIL_PASS, // Your Gmail App Password
        },
        // Add a connection timeout to prevent hanging
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 10000, // 10 seconds
        socketTimeout: 10000, // 10 seconds
    });

    // 2. Define the email options.
    const mailOptions = {
        from: `KOPKAKA <${process.env.EMAIL_FROM}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
    };

    // 3. Send the email and return the info.
    // The `await` here ensures that the forgotPassword controller waits for
    // the email to be sent (or fail) before proceeding.
    const info = await transporter.sendMail(mailOptions);
    return info;
};

module.exports = sendEmail;