import { IUser } from "../../models/user.model";
import { Document } from "mongoose";

declare global {
  namespace Express {
    interface Request {
      user?: (IUser & Document) | null;
    }
  }
}

export {}; 