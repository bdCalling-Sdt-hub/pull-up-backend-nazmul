const express = require("express");
const cors = require("cors");
const userRouter = require("./routes/userRouter");
const packageRouter = require("./routes/packageRouter");
const productRouter = require("./routes/productRouter");
const eventRouter = require("./routes/eventRouter");
const reviewRouter = require("./routes/reviewRouter");
const privacyRouter = require("./routes/privacyRouter");
const termsRouter = require("./routes/termsRouter");
const aboutRouter = require("./routes/aboutRouter");
const supportRouter = require("./routes/supportRouter");
const notificationRouter = require("./routes/notificationRouter");
const paymentRouter = require("./routes/paymentRouter");
const favoriteRouter = require("./routes/favoriteRouter");

const { notFoundHandler, errorHandler } = require("./middlewares/errorHandler");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const globalErrorHandler = require("./middlewares/GlobalErrorHanlder");
const User = require("./models/User");
const AppError = require("./errors/AppError");
const httpStatus = require("http-status");
const sendResponse = require("./utils/sendResponse");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();
const app = express(); 
// app.set('view engine', 'ejs');
// app.set('views', './views');
// Connect to the MongoDB database
mongoose
  .connect(process.env.MONGODB_CONNECTION)
  .then((res) => {
    console.log("Database connection success");
  })
  .catch((error) => {
    console.log(error);
  });
// console.log(process.env.MONGODB_CONNECTION)

//making public folder static for publicly access
app.use(express.static("public"));

// For handling form data
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// app.get('/profile', (req, res) => {
//   res.render('profile');
// });
// Enable CORS
app.use(
  cors({
    origin: "*",
    optionsSuccessStatus: 200,
  })
);

// app.use(
//     cors({
//         origin: ["http://localhost:5173"],
//     })
// );

// //initilizing socketIO
// const http = require('http');
// const socketIo = require('socket.io');
// const server = http.createServer(app);
// const io = socketIo(server, {
//     cors: {
//         origin: "*"
//     }
// });

// const socketIO = require("./helpers/socketIO");
// socketIO(io);

// global.io = io

// const socketIOPort = process.env.SOCKET_IO_PORT
// server.listen(socketIOPort, () => {
//     console.log(`Server is listening on port: ${socketIOPort}`);
// });

//initilizing API routes
app.use("/api/users", userRouter);
app.use("/api/package", packageRouter);
app.use("/api/product", productRouter);
app.use("/api/event", eventRouter);
app.use("/api/review", reviewRouter);
app.use("/api/privacy", privacyRouter);
app.use("/api/terms", termsRouter);
app.use("/api/about", aboutRouter);
app.use("/api/support", supportRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/payment", paymentRouter);
app.use("/api/favorite", favoriteRouter);
app.use("/api/stripe-return", async(req, res) => {

  const {user_id, st} = req.query
  const paymentId =st
  const user = await User.findById(user_id);
  if (!user) {
    throw new AppError(httpStatus.BAD_REQUEST, 'User not found!');
  }

  try {
    const result = await User.findByIdAndUpdate(user?._id, {stripeConnectAccountId: paymentId}, {new : true});
    req.redirect("https://pullupapp.net/")
    sendResponse(res, { statusCode: httpStatus.OK, data: result, message: 'your account successfully done', success: true });
  } catch (error) {
    throw new AppError(httpStatus.BAD_REQUEST, "user stripe account creation failed")
  } 
});
app.use("/api/stripe-refresh/:id", async(req, res) => {
  const user = await User.findById(req?.query?.user_id);
  const paymentId = req.params.id
  if (!user) {
    throw new AppError(httpStatus.BAD_REQUEST, 'User not found!');
  }

  try {
    const accountLink = await stripe.accountLinks.create({
      account: paymentId,
      return_url: `${process.env.SERVER_URL}/stripe-return?st=${paymentId}&user_id=${user.id}`,
      refresh_url: `${process.env.SERVER_URL}/stripe-refresh/${paymentId}?user_id=${user?._id}`,
      type: "account_onboarding",
    }); 
    
   res.redirect(accountLink.url);
     
 
  } catch (error) {
    throw new AppError(httpStatus.BAD_REQUEST, error.message);
  } 
});

//testing API is alive

app.get("/test", (req, res) => {
  res.send("Hello World");
});

//invalid route handler
app.use(notFoundHandler);
//error handling
app.use(globalErrorHandler);

module.exports = app;
