import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { User } from "../models/user.model";
import { ApiResponse } from "../utils/apiResponse";

type UserRegisterRequest = {
    userName: string;
    email: string;
    firstName: string;
    middleName: string;
    lastName: string;
    phoneNumber: string;
    role: string;
    password: string;
}

export const register = asyncHandler(async (req: Request<{}, {}, UserRegisterRequest>, res: Response, next: NextFunction) => {
    const { userName, email, firstName, middleName, lastName, phoneNumber, role, password } = req.body;

    // validate data
    if ([firstName, userName, email, lastName, phoneNumber, role, password].some(value => !value || value?.trim() === '')) {
        throw new ApiError(400, "All fields are required !");
    }

    // check if user exists
    const existedUser = await User.findOne({
        $or: [{ userName }, { email }]
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
    })
    console.log("User: ", user);

    const createdUser = await User.findById(user._id).select("-password -refreshToken");
    console.log("Created User: ", createdUser);

    if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering the user")
    }

    res.status(201).json(
        new ApiResponse(200, createdUser, "User registered Successfully")
    )
})