import express, { Application } from "express";
import dbConnect from "./config/dbConnect";
import dotenv from "dotenv";

dotenv.config({ path: "./.env" });

dbConnect();
