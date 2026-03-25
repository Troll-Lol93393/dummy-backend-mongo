import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { User } from "../models/user.model";
import { ApiResponse } from "../utils/apiResponse";
import { validateEmail, validatePassword, validateUserName } from "../utils/validation";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendOtpEmail } from "../utils/mailer";

type UserRegisterRequest = {
    userName: string;
    email: string;
    firstName: string;
    middleName: string;
    lastName: string;
    phoneNumber: string;
    role: string;
    password: string;
};

const generateAccessRefreshToken = async (userId: string) => {
    try {
        const user = await User.findById(userId);
        if (user) {
            const accessToken = await user.generateAccessToken();
            const refreshToken = await user.generateRefreshToken();
            user.refreshToken = refreshToken;
            await user.save({ validateBeforeSave: false });
            return { refreshToken, accessToken };
        }
        return {};
    } catch (error) {
        throw new ApiError(
            500,
            "Something went wrong while generating referesh and access token",
            error as string[]
        );
    }
};

export const register = asyncHandler(
    async (req: Request<{}, {}, UserRegisterRequest>, res: Response, next: NextFunction) => {
        const { userName, email, firstName, middleName, lastName, phoneNumber, role, password } =
            req.body;

        // validate required fields
        if (
            [firstName, userName, email, lastName, password].some(
                value => !value || value?.trim() === ""
            )
        ) {
            throw new ApiError(
                400,
                "First name, username, email, last name, and password are required!"
            );
        }

        // validate email format
        if (!validateEmail(email)) {
            throw new ApiError(400, "Please provide a valid email address");
        }

        // validate username
        const userNameValidation = validateUserName(userName);
        if (!userNameValidation.isValid) {
            throw new ApiError(400, userNameValidation.message!);
        }

        // validate password
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.isValid) {
            throw new ApiError(400, passwordValidation.message!);
        }

        // check if user exists
        const existedUser = await User.findOne({
            $or: [{ userName }, { email }],
        });

        if (existedUser) {
            throw new ApiError(400, "User already exists !");
        }

        // create User
        const user = await User.create({
            userName,
            firstName,
            middleName: middleName ?? "",
            password,
            lastName,
            role,
            email,
            phoneNumber,
        });

        const createdUser = await User.findById(user._id).select("-password -refreshToken");

        if (!createdUser) {
            throw new ApiError(500, "Something went wrong while registering the user");
        }

        res.status(201).json(new ApiResponse(200, createdUser, "User registered Successfully"));
    }
);

export const login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;

    // validate data
    if (!email || !password) {
        throw new ApiError(400, "All fields are required !");
    }

    // check if user exists
    const user = await User.findOne({ email });

    if (!user) {
        throw new ApiError(400, "Invalid credentials !");
    }

    // check if password is correct
    const isPasswordCorrect = await user.comparePassword(password);

    if (!isPasswordCorrect) {
        throw new ApiError(400, "Invalid credentials !");
    }

    const { accessToken, refreshToken } = await generateAccessRefreshToken(user._id.toString());

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

    const options = {
        httpOnly: true,
        secure: true,
    };

    res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new ApiResponse(
                200,
                {
                    user: loggedInUser,
                    accessToken,
                    refreshToken,
                },
                "User logged In Successfully"
            )
        );
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
    await User.findByIdAndUpdate(
        req.user?._id,
        {
            $unset: {
                refreshToken: 1,
            },
        },
        {
            new: true,
        }
    );

    const options = {
        httpOnly: true,
        secure: true,
    };

    res.status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(new ApiResponse(200, {}, "User logged out successfully"));
});

export const refreshAccessToken = asyncHandler(async (req: Request, res: Response) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken) {
        throw new ApiError(401, "Unauthorized request");
    }

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET as string
        ) as any;

        const user = await User.findById(decodedToken?._id);

        if (!user) {
            throw new ApiError(401, "Invalid refresh token");
        }

        if (incomingRefreshToken !== user?.refreshToken) {
            throw new ApiError(401, "Refresh token is expired or used");
        }

        const options = {
            httpOnly: true,
            secure: true,
        };

        const { accessToken, refreshToken } = await generateAccessRefreshToken(user._id.toString());

        res.status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(new ApiResponse(200, { accessToken, refreshToken }, "Access token refreshed"));
    } catch (error) {
        throw new ApiError(401, "Invalid refresh token");
    }
});

export const getCurrentUser = asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(new ApiResponse(200, req.user, "Current user fetched successfully"));
});

export const updateUserProfile = asyncHandler(async (req: Request, res: Response) => {
    const { firstName, lastName, phoneNumber, middleName } = req.body;

    if (!firstName || !lastName) {
        throw new ApiError(400, "First name and last name are required");
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: {
                firstName,
                lastName,
                phoneNumber,
                middleName,
            },
        },
        { new: true }
    ).select("-password -refreshToken");

    res.status(200).json(new ApiResponse(200, user, "Profile updated successfully"));
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
        throw new ApiError(400, "Old password and new password are required");
    }

    const user = await User.findById(req.user?._id);
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const isPasswordCorrect = await user.comparePassword(oldPassword);

    if (!isPasswordCorrect) {
        throw new ApiError(400, "Invalid old password");
    }

    user.password = newPassword;
    await user.save({ validateBeforeSave: false });

    res.status(200).json(new ApiResponse(200, {}, "Password changed successfully"));
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;

    if (!email) {
        throw new ApiError(400, "Email is required");
    }

    const user = await User.findOne({ email });

    if (!user) {
        // Don't leak whether the user exists
        res.status(200).json(
            new ApiResponse(200, {}, "If an account with that email exists, an OTP has been sent")
        );
        return;
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash the OTP and store it
    user.resetOtp = crypto.createHash("sha256").update(otp).digest("hex");
    user.resetOtpExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await user.save({ validateBeforeSave: false });

    // Send the OTP via email
    await sendOtpEmail(email, otp);

    res.status(200).json(
        new ApiResponse(200, {}, "If an account with that email exists, an OTP has been sent")
    );
});

export const verifyResetOtp = asyncHandler(async (req: Request, res: Response) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        throw new ApiError(400, "Email and OTP are required");
    }

    // Hash the incoming OTP to compare with stored hash
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    const user = await User.findOne({
        email,
        resetOtp: hashedOtp,
        resetOtpExpires: { $gt: new Date() },
    });

    if (!user) {
        throw new ApiError(400, "Invalid or expired OTP");
    }

    // Generate a short-lived reset token
    const resetToken = crypto.randomBytes(32).toString("hex");

    user.resetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    user.resetPasswordExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Clear OTP fields
    user.resetOtp = undefined;
    user.resetOtpExpires = undefined;

    await user.save({ validateBeforeSave: false });

    res.status(200).json(new ApiResponse(200, { resetToken }, "OTP verified successfully"));
});

export const resendOtp = asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;

    if (!email) {
        throw new ApiError(400, "Email is required");
    }

    const user = await User.findOne({ email });

    if (!user) {
        // Don't leak whether the user exists
        res.status(200).json(
            new ApiResponse(200, {}, "If an account with that email exists, an OTP has been sent")
        );
        return;
    }

    // Generate a new 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash the OTP and store it
    user.resetOtp = crypto.createHash("sha256").update(otp).digest("hex");
    user.resetOtpExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await user.save({ validateBeforeSave: false });

    // Send the OTP via email
    await sendOtpEmail(email, otp);

    res.status(200).json(
        new ApiResponse(200, {}, "If an account with that email exists, an OTP has been sent")
    );
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
        throw new ApiError(400, "Token and new password are required");
    }

    // Validate new password
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
        throw new ApiError(400, passwordValidation.message!);
    }

    // Hash the incoming token to compare with stored hash
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
        throw new ApiError(400, "Invalid or expired reset token");
    }

    // Set new password (pre-save hook will hash it)
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save({ validateBeforeSave: false });

    res.status(200).json(new ApiResponse(200, {}, "Password has been reset successfully"));
});
