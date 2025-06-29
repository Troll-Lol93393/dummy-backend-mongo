import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/apiError";
import { User } from "../models/user.model";

interface JwtPayloadWithId extends jwt.JwtPayload {
  _id: string;
}

export const verifyJWT = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const cookie = req?.cookies?.token || req.body?.token || req.header("Authorization")?.replace("Bearer ", "");

  if (!cookie) {
    throw new ApiError(401, "Unauthorized Request !");
  }

  try {
    const decodedToken = jwt.verify(cookie as string, process.env.JWT_SECRET_KEY as string) as JwtPayloadWithId;
    const user = await User.findById(decodedToken._id).select("-password -refreshToken");
    req.user = user;
    next();
  } catch (error) {
    throw new ApiError(500, "An issue occurred while verifying JWT", [String(error)]);
  }
});