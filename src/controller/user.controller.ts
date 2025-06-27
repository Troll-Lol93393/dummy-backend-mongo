import { Request, Response, NextFunction } from "express";

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

export const register = async (req: Request<{}, {}, UserRegisterRequest>, res: Response, next: NextFunction) => {
    const { userName, email, firstName, middleName, lastName, phoneNumber, role, password } = req.body;

    return res.status(200).json({
        message: "User registered successfully",
    });
}