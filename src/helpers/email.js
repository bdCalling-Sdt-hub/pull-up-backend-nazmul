const nodemailer = require("nodemailer");
require("dotenv").config();

const sendEmail = async (to, subject, html) => {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com.",
    port: 587,
    secure: true,
    auth: {
      user: "farvezhossen101@gmail.com",
      pass: "durg jobq bjak lkqb",
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  await transporter.sendMail({
    from: `Pull Up ${process.env.SMTP_USERNAME}`,
    to,
    subject,
    text: "",
    html,
  });
};

module.exports = sendEmail;
