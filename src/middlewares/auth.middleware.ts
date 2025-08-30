import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/apiError";
import { User } from "../models/user.model";

interface JwtPayloadWithId extends jwt.JwtPayload {
  _id: string;
}

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

export const verifyJWT = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      throw new ApiError(401, "Unauthorized Request - No token provided");
    }

    try {
      const decodedToken = jwt.verify(
        token,
        process.env.ACCESS_TOKEN_SECRET as string
      ) as JwtPayloadWithId;
      const user = await User.findById(decodedToken._id).select(
        "-password -refreshToken"
      );

      if (!user) {
        throw new ApiError(401, "Invalid access token - User not found");
      }

      req.user = user;
      next();
    } catch (error) {
      throw new ApiError(401, "Invalid access token", [String(error)]);
    }
  }
);

export const verifyRoles = (...allowedRoles: string[]) => {
  return asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
      if (!req.user) {
        throw new ApiError(
          401,
          "Unauthorized request - User not authenticated"
        );
      }

      if (!allowedRoles.includes(req.user.role)) {
        throw new ApiError(403, "Access denied - Insufficient permissions");
      }

      next();
    }
  );
};
