import mongoose, { Schema } from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken"

export interface IUser {
    userName: string;
    email: string;
    firstName: string;
    middleName: string;
    lastName: string;
    phoneNumber: string;
    role: string;
    password: string;
    refreshToken: string;
}

export const userSchema: Schema<IUser> = new Schema<IUser>(
    {
        userName: {
            type: String,
            lowercase: true,
            require: [true, "Username is required !"],
            trim: true,
            unique: true,
            index: true,
        },
        email: {
            type: String,
            trim: true,
            require: [true, "Email is required !"],
            unique: true,
        },
        firstName: {
            type: String,
            trim: true,
            require: [true, "First Name is required !"],
        },
        middleName: {
            type: String,
            trim: true,
        },
        lastName: {
            type: String,
            trim: true,
            require: [true, "Last Name is required !"],
        },
        phoneNumber: {
            type: String,
            trim: true,
        },
        role: {
            type: String,
            enum: ["ROLE_ADMIN", "ROLE_MANAGER", "ROLE_APPROVER", "ROLE_USER", "ROLE_TECH_ADMIN"],
            default: "ROLE_USER",
            require: [true, "Role is required !"],
        },
        password: {
            type: String,
            require: [true, "Password is required !"]
        },
        refreshToken: {
            type: String,
        },
    },
    {
        timestamps: true,
    }
)

// to save encrypted password to db
userSchema.pre("save", async function (next) {
    if(!this.isModified("password")) return next();

    this.password = await bcrypt.hash(this.password as string, 10)
    next()
});

userSchema.methods.comparePassword = async function(password: string) {
    return await bcrypt.compare(password, this.password as string)
}

// to generate JWT Tokens
userSchema.methods.generateAccessToken = function() {
    return jwt.sign(
        {
            _id: this._id,
            email: this.email,
            userName: this.userName,  
        },
        process.env.ACCESS_TOKEN_SECRET as string,
        {
            expiresIn: Number(process.env.ACCESS_TOKEN_EXPIRY) || 3600,
            algorithm: "HS256"
        }
    );
}

userSchema.methods.generateRefreshToken = function() {
    return jwt.sign(
        {
            _id: this._id,
        },
        process.env.REFRESH_TOKEN_SECRET as string,
        {
            expiresIn: Number(process.env.REFRESH_TOKEN_EXPIRY) || 604800,
            algorithm: "HS256"
        }
    )
}

export const User = mongoose.model("User", userSchema)