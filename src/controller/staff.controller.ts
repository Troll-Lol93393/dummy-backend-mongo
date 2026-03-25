import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { User } from "../models/user.model";
import { validateEmail, validatePassword, validateUserName } from "../utils/validation";

export const getAllStaff = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size as string) || 10));
    const search = ((req.query.search as string) || "").trim();
    const sortBy = (req.query.sortBy as string) || "createdAt";
    const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;

    const filter: Record<string, unknown> = {};
    if (search) {
        const regex = new RegExp(search, "i");
        filter.$or = [
            { firstName: regex },
            { lastName: regex },
            { email: regex },
            { userName: regex },
            { phoneNumber: regex },
        ];
    }

    const [data, total] = await Promise.all([
        User.find(filter)
            .select("-password -refreshToken -resetOtp -resetOtpExpires -resetPasswordToken -resetPasswordExpires")
            .sort({ [sortBy]: sortOrder })
            .skip((page - 1) * size)
            .limit(size)
            .lean(),
        User.countDocuments(filter),
    ]);

    res.status(200).json(
        new ApiResponse(
            200,
            { data, total, page, size, totalPages: Math.ceil(total / size) },
            "Staff fetched successfully"
        )
    );
});

export const getStaffById = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const { id } = req.params;

        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            throw new ApiError(400, "Invalid staff ID");
        }

        const staff = await User.findById(id).select(
            "-password -refreshToken -resetOtp -resetOtpExpires -resetPasswordToken -resetPasswordExpires"
        );

        if (!staff) {
            throw new ApiError(404, "Staff member not found");
        }

        res.status(200).json(new ApiResponse(200, staff, "Staff fetched successfully"));
    }
);

export const createStaff = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const { userName, email, firstName, middleName, lastName, phoneNumber, role, password } =
            req.body;

        if (!firstName || !lastName || !userName || !email || !password) {
            throw new ApiError(
                400,
                "First name, last name, username, email, and password are required"
            );
        }

        if (!validateUserName(userName)) {
            throw new ApiError(
                400,
                "Username must be at least 3 characters and contain only letters, numbers, and underscores"
            );
        }

        if (!validateEmail(email)) {
            throw new ApiError(400, "Invalid email address");
        }

        if (!validatePassword(password)) {
            throw new ApiError(
                400,
                "Password must be at least 8 characters with uppercase, lowercase, and a number"
            );
        }

        const existingUser = await User.findOne({
            $or: [{ email: email.toLowerCase() }, { userName: userName.toLowerCase() }],
        });
        if (existingUser) {
            throw new ApiError(
                409,
                existingUser.email === email.toLowerCase()
                    ? "Email already in use"
                    : "Username already taken"
            );
        }

        const validRoles = ["ROLE_ADMIN", "ROLE_OFFICE_STAFF", "ROLE_FIELD_STAFF"];
        if (role && !validRoles.includes(role)) {
            throw new ApiError(400, `Invalid role. Allowed: ${validRoles.join(", ")}`);
        }

        const staff = await User.create({
            userName: userName.toLowerCase(),
            email: email.toLowerCase(),
            firstName: firstName.trim(),
            middleName: middleName?.trim() || "",
            lastName: lastName.trim(),
            phoneNumber: phoneNumber?.trim() || "",
            role: role || "ROLE_FIELD_STAFF",
            password,
        });

        const created = await User.findById(staff._id).select(
            "-password -refreshToken -resetOtp -resetOtpExpires -resetPasswordToken -resetPasswordExpires"
        );

        res.status(201).json(new ApiResponse(201, created, "Staff member created successfully"));
    }
);

export const updateStaff = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const { id } = req.params;

        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            throw new ApiError(400, "Invalid staff ID");
        }

        const staff = await User.findById(id);
        if (!staff) {
            throw new ApiError(404, "Staff member not found");
        }

        // Prevent editing the ROLE_OWNER account
        if (staff.role === "ROLE_OWNER") {
            throw new ApiError(403, "Cannot edit the owner account");
        }

        const { firstName, middleName, lastName, phoneNumber, role, email } = req.body;

        if (firstName !== undefined) staff.firstName = firstName.trim();
        if (middleName !== undefined) staff.middleName = middleName.trim();
        if (lastName !== undefined) staff.lastName = lastName.trim();
        if (phoneNumber !== undefined) staff.phoneNumber = phoneNumber.trim();

        if (email && email !== staff.email) {
            if (!validateEmail(email)) {
                throw new ApiError(400, "Invalid email address");
            }
            const existing = await User.findOne({ email: email.toLowerCase(), _id: { $ne: id } });
            if (existing) {
                throw new ApiError(409, "Email already in use");
            }
            staff.email = email.toLowerCase();
        }

        const validRoles = ["ROLE_ADMIN", "ROLE_OFFICE_STAFF", "ROLE_FIELD_STAFF"];
        if (role) {
            if (!validRoles.includes(role)) {
                throw new ApiError(400, `Invalid role. Allowed: ${validRoles.join(", ")}`);
            }
            staff.role = role;
        }

        await staff.save({ validateBeforeSave: false });

        const updated = await User.findById(id).select(
            "-password -refreshToken -resetOtp -resetOtpExpires -resetPasswordToken -resetPasswordExpires"
        );

        res.status(200).json(new ApiResponse(200, updated, "Staff member updated successfully"));
    }
);

export const deleteStaff = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const { id } = req.params;

        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            throw new ApiError(400, "Invalid staff ID");
        }

        const staff = await User.findById(id);
        if (!staff) {
            throw new ApiError(404, "Staff member not found");
        }

        if (staff.role === "ROLE_OWNER") {
            throw new ApiError(403, "Cannot delete the owner account");
        }

        await User.findByIdAndDelete(id);

        res.status(200).json(new ApiResponse(200, null, "Staff member deleted successfully"));
    }
);

export const resetStaffPassword = asyncHandler(
    async (req: Request, res: Response, _next: NextFunction) => {
        const { id } = req.params;
        const { newPassword } = req.body;

        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            throw new ApiError(400, "Invalid staff ID");
        }

        if (!newPassword || !validatePassword(newPassword)) {
            throw new ApiError(
                400,
                "Password must be at least 8 characters with uppercase, lowercase, and a number"
            );
        }

        const staff = await User.findById(id);
        if (!staff) {
            throw new ApiError(404, "Staff member not found");
        }

        if (staff.role === "ROLE_OWNER") {
            throw new ApiError(403, "Cannot reset password for the owner account");
        }

        staff.password = newPassword;
        await staff.save();

        res.status(200).json(new ApiResponse(200, null, "Password reset successfully"));
    }
);
