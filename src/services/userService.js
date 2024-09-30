const httpStatus = require("http-status");
const AppError = require("../errors/AppError");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const QueryBuilder = require("../builder/QueryBuilder");
const dayjs = require("dayjs");
const Package = require("../models/Package");
const unlinkImage = require("../common/image/unlinkImage");
const moment = require("moment");
const fs = require("fs");
const Payment = require("../models/Payment");
const sendEmail = require("../helpers/email");

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Define a map to store user timers for sign up requests
const userTimers = new Map();

// Create a new user
const addUser = async (userBody) => {
  const { name, email, phoneNumber, password, role } = userBody;

  // Check if the user already exists
  const userExist = await User.findOne({ email });
  if (userExist) {
    throw new AppError(
      httpStatus.CONFLICT,
      "User already exists! Please login"
    );
  }

  const oneTimeCode = Math.floor(Math.random() * (99999 - 10000 + 1)) + 10000;
  console.log("🚀 ~ addUser ~ oneTimeCode:", oneTimeCode)

  // Create the user in the database
  const user = await User.create({
    name,
    email,
    phoneNumber,
    password,
    role,
    oneTimeCode,
  });

  // Clear any previous timer for the user (if exists)
  if (userTimers.has(user._id)) {
    clearTimeout(userTimers.get(user._id));
  }

  // Set a new timer for the user to reset oneTimeCode after 3 minutes
  const userTimer = setTimeout(async () => {
    try {
      user.oneTimeCode = null;
      await user.save();
      console.log(
        `OneTimeCode for user ${user._id} reset to null after 3 minutes`
      );
      userTimers.delete(user._id);
    } catch (error) {
      console.error(`Error updating oneTimeCode for user ${user._id}:`, error);
    }
  }, 180000);

  // Store the timer reference in the map
  userTimers.set(user._id, userTimer);

  await sendEmail(
    email,
    "Account Activation Email",
    `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4CAF50;">Your One Time OTP</h2>
      <div style="background-color: #f2f2f2; padding: 20px; border-radius: 5px;">
        <p style="font-size: 16px;">Your OTP is: <strong>${oneTimeCode}</strong></p>
        <p style="font-size: 14px; color: #666;">This Code is valid for 3 minutes</p>
      </div>
    </div>
    <p>Hello, Farvez Hossen</p>
    <p>Your One Time Code is <strong>${oneTimeCode}</strong> to reset your password</p>
    <small>This Code is valid for 3 minutes</small>
  `
  );

  return user;
};

// Sign in a user
const userSignIn = async (userBody) => {
  console.log(userBody);
  const { email, password } = userBody;
  const user = await User.findOne({ email });
  if (!user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User Not Found");
  }
  if (user.emailVerified === false) {
    throw new AppError(httpStatus.NOT_ACCEPTABLE, "Email not verified");
  }
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Password Doesn't Match");
  }

  // Token, set the Cokkie
  const accessToken = jwt.sign(
    { userId: user._id, email: user.email, role: user.role },
    process.env.JWT_ACCESS_TOKEN,
    { expiresIn: "7d" }
  );

  return { user, accessToken };
};

// Verify Email
const emailVerification = async (userBody) => {
  const { oneTimeCode, email } = userBody;
  console.log(userBody);
  const user = await User.findOne({ email: email });
  if (!user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User Not Found");
  }

  if (user?.oneTimeCode !== oneTimeCode) {
    throw new AppError(httpStatus.FORBIDDEN, "otp did not match");
  }
  const result = await User.findByIdAndUpdate(user?._id, {
    $set: {
      emailVerified: true,
    },
  });
  return result;
};

// Forgot Password
const forgetPassword = async (email) => {
  console.log(email);
  // Check if the user already exists
  const user = await User.findOne({ email });
  if (!user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User Not Found");
  }

  // Generate OTC (One-Time Code)
  const oneTimeCode = Math.floor(Math.random() * (9999 - 1000 + 1)) + 10000;

  // Store the OTC and its expiration time in the database
  user.oneTimeCode = oneTimeCode;
  await user.save();

  // Send email
  try {
    await sendEmail(
      email,
      "Password Reset Email",
      `
          <h1>Hello, ${user.name}</h1>
          <p>Your One Time Code is <h3>${oneTimeCode}</h3> to reset your password</p>
          <small>This Code is valid for 3 minutes</small>
        `
    );
  } catch (emailError) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "Failed to send verification email"
    );
  }

  // Set a timeout to update the oneTimeCode to null after 1 minute
  setTimeout(async () => {
    try {
      user.oneTimeCode = null;
      await user.save();
      console.log("oneTimeCode reset to null after 3 minute");
    } catch (error) {
      console.error("Error updating oneTimeCode:", error);
    }
  }, 180000); // 3 minute in milliseconds

  // res.status(201).json({ message: 'Sent One Time Code successfully' });
  return user;
};

// Forgot Password Verify One Time Code
const forgetPasswordVerifyOneTimeCode = async (userBody, email) => {
  const { oneTimeCode } = userBody;
  console.log(oneTimeCode);
  const user = await User.findOne({ email });
  console.log(user);
  if (!user) {
    throw new AppError(400, "user not found!");
  }
  if (oneTimeCode !== user?.oneTimeCode) {
    throw new AppError(400, "otp did not match");
  }
  const result = await User.findByIdAndUpdate(
    user?._id,
    {
      $set: {
        emailVerified: true,
      },
    },
    { new: true }
  );
  return result;
};

// Reset update password
const resetUpdatePassword = async (userBody, email) => {
  const { password } = userBody;
  const user = await User.findOne({ email });
  if (!user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not found");
  } else {
    user.password = password;
    await user.save();
    return user;
  }
};

// Forget password for app
const forgetPasswordApp = async (userBody) => {
  const { email } = userBody;
  console.log(email);
  // Check if the user already exists
  const user = await User.findOne({ email });
  if (!user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User Not Found");
  }

  // Generate OTC (One-Time Code)
  const oneTimeCode = Math.floor(Math.random() * (9999 - 1000 + 1)) + 10000;

  // Store the OTC and its expiration time in the database
  user.oneTimeCode = oneTimeCode;
  await user.save();

  // Send email
  try {
    await sendEmail(
      email,
      "Password Reset Email",
      `
         <h1>Hello, ${user.name}</h1>
        <p>Your One Time Code is <h3>${oneTimeCode}</h3> to reset your password</p>
        <small>This Code is valid for 3 minutes</small>
        `
    );
  } catch (emailError) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "Failed to send verification email"
    );
  }

  // Set a timeout to update the oneTimeCode to null after 1 minute
  setTimeout(async () => {
    try {
      user.oneTimeCode = null;
      await user.save();
      console.log("oneTimeCode reset to null after 3 minute");
    } catch (error) {
      console.error("Error updating oneTimeCode:", error);
    }
  }, 180000); // 3 minute in milliseconds

  // res.status(201).json({ message: 'Sent One Time Code successfully' });
  return user;
};

// Forgot Password Verify One Time Code for App
const forgetPasswordVerifyOneTimeCodeApp = async (userBody) => {
  const { email, oneTimeCode } = userBody;
  console.log(oneTimeCode);
  const user = await User.findOne({ email });
  console.log(user);
  if (!user) {
    throw new AppError(400, "user not found!");
  }
  if (oneTimeCode !== user?.oneTimeCode) {
    throw new AppError(400, "otp did not match");
  }
  const result = await User.findByIdAndUpdate(
    user?._id,
    {
      $set: {
        emailVerified: true,
      },
    },
    { new: true }
  );
  return result;
};

// Reset update password for app
const resetUpdatePasswordApp = async (userBody) => {
  const { email, password } = userBody;
  const user = await User.findOne({ email });
  if (!user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not found");
  } else {
    user.password = password;
    await user.save();
    return user;
  }
};

// Upgrade Account
const upgradeAccount = async (userBody, loginId) => {
  const {
    accountType,
    location,
    packageDuration,
    activationDate,
    mapLocation,
  } = userBody;

  let mLocation;
  if (mapLocation) {
    mLocation =
      typeof mapLocation === "object" ? mapLocation : JSON.parse(mapLocation);
  }

  const user = await User.findOne({ _id: loginId });
  if (!user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not found");
  }

  let mapLocationData;
  if (mapLocation) {
    const coordinates = Object.values(mLocation);
    mapLocationData = { coordinates };
  }

  user.accountType = accountType;
  user.location = location;
  user.packageDuration = packageDuration;
  user.activationDate = activationDate;

  const expirationDay = (activationDate) => {
    return dayjs(activationDate).add(1, "day").toDate();
  };

  const expirationWeekly = (activationDate) => {
    return dayjs(activationDate).add(7, "day").toDate();
  };

  const expirationMonth = (activationDate) => {
    return dayjs(activationDate).add(1, "month").toDate();
  };

  if (packageDuration === "daily") {
    const expirationDate = expirationDay(activationDate);
    user.expirationDate = expirationDate;
  }

  if (packageDuration === "weekly") {
    const expirationDate = expirationWeekly(activationDate);
    user.expirationDate = expirationDate;
  }

  if (packageDuration === "monthly") {
    const expirationDate = expirationMonth(activationDate);
    user.expirationDate = expirationDate;
  }

  user.save();

  return user;
};

const updatedAccount = async (userBody, loginEmail, files, ip) => {
  const {
    businessName,
    businessNumber,
    businessEmail,
    businessDescription,
    businessWebsite,
    businessHours,
    businessLocation,
    name,
    phoneNumber,
    email,
    location,
    organisationName,
    organisationNumber,
    organisationEmail,
    organisationDescription,
    organisationWebsite,
    organisationLocation,
  } = userBody;
  const user = await User.findOne({ email: loginEmail });
  if (!user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User not Found");
  }

  const account = await stripe.accounts.create({});

  const accountLink = await stripe.accountLinks.create({
    account: account.id,
    return_url: `${process.env.SERVER_URL}/stripe-return?st=${account.id}&user_id=${user.id}`,
    refresh_url: `${process.env.SERVER_URL}/stripe-refresh/${account.id}?user_id=${user?._id}`,
    type: "account_onboarding",
  });

  if (user.accountType === "business") {
    try {
      if (organisationLocation) {
        const businessLocationData =
          typeof organisationLocation === "object"
            ? businessLocation
            : await JSON.parse(businessLocation);
        user.location = !businessLocationData.city
          ? user.location
          : businessLocationData.city;
      }

      user.businessName = businessName;
      user.businessNumber = businessNumber;
      user.businessEmail = businessEmail;
      user.businessDescription = businessDescription;
      user.businessWebsite = businessWebsite;
      user.businessHours = businessHours;
    } catch (error) {
      throw new AppError(400, error?.message);
    }
  } else if (user.accountType === "shopping") {
    user.name = !name ? user.name : name;
    user.phoneNumber = !phoneNumber ? user.phoneNumber : phoneNumber;
    user.email = !email ? user.email : email;
    user.location = !location ? user.location : location;
  } else if (user.accountType === "organisation") {
    // stripeConnectAccountId

    if (organisationLocation) {
      const organisationLocationData =
        typeof organisationLocation === "object"
          ? organisationLocation
          : await JSON.parse(organisationLocation);
      user.location = !organisationLocationData.city
        ? user.location
        : organisationLocationData.city;
    }

    user.organisationName = organisationName;
    user.organisationNumber = organisationNumber;
    user.organisationEmail = organisationEmail;
    user.organisationDescription = organisationDescription;
    user.organisationWebsite = organisationWebsite;
  } else {
    throw new AppError(httpStatus.METHOD_NOT_ALLOWED, "Invalid Account type");
  }
  if (files.image) {
    const defaultPath = "public\\uploads\\product\\user.png";
    if (user?.image?.path !== defaultPath) {
      await unlinkImage(user?.image?.path);
    }

    user.image = {
      publicFileUrl: `${process.env.IMAGE_UPLOAD_BACKEND_DOMAIN}/uploads/users/${files?.image[0]?.filename}`,
      path: `/uploads/users/${files?.image[0]?.filename}`,
    };
  }

  const updatedUser = await user.save();
  return user.accountType === "shopping"
    ? updatedUser
    : { ...updatedUser.toObject(), url: accountLink.url };
};

// All Users
const getAllUsers = async (query) => {
  const userModel = new QueryBuilder(User.find(), query)
    .search()
    .filter()
    .paginate()
    .sort()
    .fields();

  const result = await userModel.modelQuery;
  const meta = await userModel.meta();
  return { result, meta };
};

const getUsersStatistics = async (query) => {
  const { year, month } = query;

  // Construct the start and end dates for the specified month and year
  const startDate = new Date(year, month - 1, 1); // Month is zero-based, so we subtract 1
  const endDate = new Date(year, month, 0); // Get the last day of the specified month

  try {
    // Aggregate to get users within the specified date range
    const result = await User.aggregate([
      {
        $match: {
          createdAt: {
            $gte: startDate,
            $lte: endDate,
          },
        },
      },
    ]);

    // Initialize statistics array with objects for each day of the month
    const statistics = Array.from({ length: endDate.getDate() }, (_, i) => ({
      name: (i + 1 < 10 ? "0" : "") + (i + 1),
      shopping: 0,
      business: 0,
      organisation: 0,
      amt: 0,
    }));

    // Update statistics based on retrieved users
    result.forEach((user) => {
      const createdAt = moment(user.createdAt);
      const day = createdAt.date();
      const accountType = user.accountType;

      // Increment count for accountType if it's not null
      if (accountType) {
        const index = day - 1; // Index starts from 0
        statistics[index][accountType]++; // Increment count for the account type
        statistics[index].amt++; // Increment total count for the day
      } else {
        // If accountType is null, set the count to 0
        const index = day - 1; // Index starts from 0
        statistics[index].amt++; // Increment total count for the day
      }
    });

    return statistics;
  } catch (error) {
    console.error("Error retrieving users:", error);
    throw error;
  }
};

// Usage
(async () => {
  try {
    const statistics = await getUsersStatistics({ year: 2024, month: 1 });
  } catch (error) {
    console.error("Error:", error);
  }
})();

// Usage
(async () => {
  try {
    const statistics = await getUsersStatistics({ year: 2024, month: 1 });
  } catch (error) {
    console.error("Error:", error);
  }
})();

// Wallet pai chart
const packagePurchaseRatio = async (query) => {
  const { year, month } = query;

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  console.log(startDate, endDate);

  const result = await User.aggregate([
    {
      $match: {
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
      },
    },
  ]);

  // const data = await User.find()
  const monthlyData = result.filter(
    (item) => item.packageDuration === "monthly"
  );
  const weeklyData = result.filter((item) => item.packageDuration === "weekly");
  const dailyData = result.filter((item) => item.packageDuration === "daily");

  const monthlyFormatted = {
    name: "Monthly",
    value: monthlyData.length,
    color: "#D0A65A",
  };

  const weeklyFormatted = {
    name: "Weekly",
    value: weeklyData.length,
    color: "#68532D",
  };

  const dailyFormatted = {
    name: "Daily",
    value: dailyData.length,
    color: "#1D1D1F",
  };

  // Combine the formatted data into an array
  const formattedData = [monthlyFormatted, weeklyFormatted, dailyFormatted];

  // Calculate total count
  const totalCount = monthlyData.length + weeklyData.length + dailyData.length;

  // Calculate percentages
  const weeklyPercent = ((weeklyData.length / totalCount) * 100).toFixed(1);
  const monthlyPercent = ((monthlyData.length / totalCount) * 100).toFixed(1);
  const dailyDataPercent = ((dailyData.length / totalCount) * 100).toFixed(1);

  return { formattedData, weeklyPercent, monthlyPercent, dailyDataPercent };
};

const totalIncomeRatio = async (query) => {
  const { year } = query;

  // Create an array to store monthly and weekly payments for each month
  const data = [];

  // Loop through each month of the year
  for (let month = 1; month <= 12; month++) {
    const startDate = dayjs(`${year}-${month}-01`).startOf("month").toDate();
    console.log("Start date of Janury:", startDate);
    const endDate = dayjs(startDate).endOf("month").toDate();

    console.log(endDate);

    // Query payments within the specified month
    const result = await Payment.find({
      createdAt: {
        $gte: startDate,
        $lte: endDate,
      },
    }).populate("userId");

    // Filter payments by package duration
    const monthlyData = result.filter(
      (item) => item?.packageDuration === "monthly"
    );
    const weeklyData = result.filter(
      (item) => item?.packageDuration === "weekly"
    );
    const dailyData = result.filter(
      (item) => item?.packageDuration === "daily"
    );

    console.log(dailyData);

    // Calculate total monthly and weekly payments
    const monthlyTotal = monthlyData.reduce(
      (total, item) => total + item?.paymentData?.amount / 100,
      0
    );
    const weeklyTotal = weeklyData.reduce(
      (total, item) => total + item?.paymentData?.amount / 100,
      0
    );
    const dailyTotal = dailyData.reduce(
      (total, item) => total + item?.paymentData?.amount / 100,
      0
    );

    // Format month name (Jan, Feb, etc.)
    const monthName = dayjs(startDate).format("MMM");

    // Add monthly and weekly payments for the month to the data array
    data.push({
      month: monthName,
      monthly: monthlyTotal,
      weekly: weeklyTotal,
      daily: dailyTotal,
    });
  }

  return data;
};

// Update User
const updateUser = async (userBody, file) => {
  const { name, phoneNumber, email } = userBody;

  console.log("userBody", userBody);

  const user = await User.findOne({ email });

  if (!user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "User Not Found");
  }

  user.name = !name ? user.name : name;
  user.phoneNumber = !phoneNumber ? user.phoneNumber : phoneNumber;

  if (file) {
    const defaultPath = "public\\uploads\\users\\user.png";
    // console.log('req.file', file, user.image.path, defaultPath);
    if (user.image.path !== defaultPath) {
      await unlinkImage(user?.image?.path);
    }

    user.image = {
      publicFileUrl: `${process.env.IMAGE_UPLOAD_BACKEND_DOMAIN}/uploads/users/${file?.file?.filename}`,
      path: `/uploads/users/${file?.file?.filename}`,
    };
  }

  const updatedUser = await user.save();
  return updatedUser;
};

const getUserProfile = async (email) => {
  const user = await User.findOne({ email });

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  return user;
};

const getSingleUser = async (id) => {
  const result = await User.findById(id);
  return result;
};

const getChangePassword = async (body, email) => {
  const { currentPassword, newPassword, confirmPassword } = body;

  const user = await User.findOne({ email });

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const passwordMatch = await bcrypt.compare(currentPassword, user.password);

  if (!passwordMatch) {
    throw new AppError(
      httpStatus.NOT_ACCEPTABLE,
      "Current password is incorrect"
    );
  }

  if (newPassword !== confirmPassword) {
    throw new AppError(
      httpStatus.NOT_ACCEPTABLE,
      "New password and re-typed password do not match"
    );
  }

  user.password = newPassword;
  await user.save();

  return user;
};

const deActiveUsers = async (body, email) => {
  const { currentPassword } = body;
  console.log(currentPassword);

  const user = await User.findOne({ email });

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const passwordMatch = await bcrypt.compare(currentPassword, user.password);

  if (!passwordMatch) {
    throw new AppError(
      httpStatus.NOT_ACCEPTABLE,
      "Current password is incorrect"
    );
  }

  return null;
};

module.exports = {
  addUser,
  userSignIn,
  emailVerification,
  forgetPassword,
  forgetPasswordApp,
  forgetPasswordVerifyOneTimeCode,
  forgetPasswordVerifyOneTimeCodeApp,
  resetUpdatePassword,
  resetUpdatePasswordApp,
  upgradeAccount,
  updatedAccount,
  getAllUsers,
  getUsersStatistics,
  packagePurchaseRatio,
  totalIncomeRatio,
  updateUser,
  getUserProfile,
  getSingleUser,
  getChangePassword,
  deActiveUsers,
};
