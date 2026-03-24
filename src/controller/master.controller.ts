import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/apiResponse";
import { RawMaterialType } from "../models/rawMaterialType.model";
import { LabourProcessType } from "../models/labourProcessType.model";
import { HardnessType } from "../models/hardnessType.model";
import { HardnessMeasurement } from "../models/hardnessMeasurement.model";

// ===================== Raw Material Type =====================

export const createRawMaterialType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { name, description } = req.body;

        if (!name || name.trim() === "") {
            throw new ApiError(400, "Raw material type name is required");
        }

        const existing = await RawMaterialType.findOne({ name, isDeleted: false });

        if (existing) {
            throw new ApiError(400, "Raw material type already exists");
        }

        const rawMaterialType = await RawMaterialType.create({
            name,
            description: description ?? "",
        });

        res.status(201).json(
            new ApiResponse(201, rawMaterialType, "Raw material type created successfully !")
        );
    }
);

export const getAllRawMaterialTypes = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const page = parseInt(req.query.page as string) || 1;
        const size = parseInt(req.query.size as string) || 10;
        const search = (req.query.search as string) || "";
        const sortBy = (req.query.sortBy as string) || "createdAt";
        const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;

        const filter: Record<string, unknown> = { isDeleted: false };
        if (search) {
            filter.name = { $regex: search, $options: "i" };
        }

        const totalCount = await RawMaterialType.countDocuments(filter);
        const rawMaterialTypes = await RawMaterialType.find(filter)
            .sort({ [sortBy]: sortOrder })
            .skip((page - 1) * size)
            .limit(size);

        res.status(200).json(
            new ApiResponse(200, {
                data: rawMaterialTypes,
                totalCount,
                page,
                size,
                totalPages: Math.ceil(totalCount / size),
            }, "Raw material types fetched successfully !")
        );
    }
);

export const updateRawMaterialType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const { name, description } = req.body;

        const rawMaterialType = await RawMaterialType.findOne({
            _id: id,
            isDeleted: false,
        });

        if (!rawMaterialType) {
            throw new ApiError(404, "Raw material type not found");
        }

        if (name !== undefined) rawMaterialType.name = name;
        if (description !== undefined) rawMaterialType.description = description;

        await rawMaterialType.save();

        res.status(200).json(
            new ApiResponse(200, rawMaterialType, "Raw material type updated successfully !")
        );
    }
);

export const deleteRawMaterialType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;

        const rawMaterialType = await RawMaterialType.findOne({
            _id: id,
            isDeleted: false,
        });

        if (!rawMaterialType) {
            throw new ApiError(404, "Raw material type not found");
        }

        rawMaterialType.isDeleted = true;
        await rawMaterialType.save();

        res.status(200).json(
            new ApiResponse(200, rawMaterialType, "Raw material type soft deleted successfully !")
        );
    }
);

// ===================== Labour Process Type =====================

export const createLabourProcessType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { name, description } = req.body;

        if (!name || name.trim() === "") {
            throw new ApiError(400, "Labour process type name is required");
        }

        const existing = await LabourProcessType.findOne({ name, isDeleted: false });

        if (existing) {
            throw new ApiError(400, "Labour process type already exists");
        }

        const labourProcessType = await LabourProcessType.create({
            name,
            description: description ?? "",
        });

        res.status(201).json(
            new ApiResponse(201, labourProcessType, "Labour process type created successfully !")
        );
    }
);

export const getAllLabourProcessTypes = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const page = parseInt(req.query.page as string) || 1;
        const size = parseInt(req.query.size as string) || 10;
        const search = (req.query.search as string) || "";
        const sortBy = (req.query.sortBy as string) || "createdAt";
        const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;

        const filter: Record<string, unknown> = { isDeleted: false };
        if (search) {
            filter.name = { $regex: search, $options: "i" };
        }

        const totalCount = await LabourProcessType.countDocuments(filter);
        const labourProcessTypes = await LabourProcessType.find(filter)
            .sort({ [sortBy]: sortOrder })
            .skip((page - 1) * size)
            .limit(size);

        res.status(200).json(
            new ApiResponse(200, {
                data: labourProcessTypes,
                totalCount,
                page,
                size,
                totalPages: Math.ceil(totalCount / size),
            }, "Labour process types fetched successfully !")
        );
    }
);

export const updateLabourProcessType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const { name, description } = req.body;

        const labourProcessType = await LabourProcessType.findOne({
            _id: id,
            isDeleted: false,
        });

        if (!labourProcessType) {
            throw new ApiError(404, "Labour process type not found");
        }

        if (name !== undefined) labourProcessType.name = name;
        if (description !== undefined) labourProcessType.description = description;

        await labourProcessType.save();

        res.status(200).json(
            new ApiResponse(200, labourProcessType, "Labour process type updated successfully !")
        );
    }
);

export const deleteLabourProcessType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;

        const labourProcessType = await LabourProcessType.findOne({
            _id: id,
            isDeleted: false,
        });

        if (!labourProcessType) {
            throw new ApiError(404, "Labour process type not found");
        }

        labourProcessType.isDeleted = true;
        await labourProcessType.save();

        res.status(200).json(
            new ApiResponse(
                200,
                labourProcessType,
                "Labour process type soft deleted successfully !"
            )
        );
    }
);

// ===================== Hardness Type =====================

export const createHardnessType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { name, description } = req.body;

        if (!name || name.trim() === "") {
            throw new ApiError(400, "Hardness type name is required");
        }

        const existing = await HardnessType.findOne({ name, isDeleted: false });

        if (existing) {
            throw new ApiError(400, "Hardness type already exists");
        }

        const hardnessType = await HardnessType.create({
            name,
            description: description ?? "",
        });

        res.status(201).json(
            new ApiResponse(201, hardnessType, "Hardness type created successfully !")
        );
    }
);

export const getAllHardnessTypes = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const page = parseInt(req.query.page as string) || 1;
        const size = parseInt(req.query.size as string) || 10;
        const search = (req.query.search as string) || "";
        const sortBy = (req.query.sortBy as string) || "createdAt";
        const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;

        const filter: Record<string, unknown> = { isDeleted: false };
        if (search) {
            filter.name = { $regex: search, $options: "i" };
        }

        const totalCount = await HardnessType.countDocuments(filter);
        const hardnessTypes = await HardnessType.find(filter)
            .sort({ [sortBy]: sortOrder })
            .skip((page - 1) * size)
            .limit(size);

        res.status(200).json(
            new ApiResponse(200, {
                data: hardnessTypes,
                totalCount,
                page,
                size,
                totalPages: Math.ceil(totalCount / size),
            }, "Hardness types fetched successfully !")
        );
    }
);

export const updateHardnessType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const { name, description } = req.body;

        const hardnessType = await HardnessType.findOne({
            _id: id,
            isDeleted: false,
        });

        if (!hardnessType) {
            throw new ApiError(404, "Hardness type not found");
        }

        if (name !== undefined) hardnessType.name = name;
        if (description !== undefined) hardnessType.description = description;

        await hardnessType.save();

        res.status(200).json(
            new ApiResponse(200, hardnessType, "Hardness type updated successfully !")
        );
    }
);

export const deleteHardnessType = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;

        const hardnessType = await HardnessType.findOne({
            _id: id,
            isDeleted: false,
        });

        if (!hardnessType) {
            throw new ApiError(404, "Hardness type not found");
        }

        hardnessType.isDeleted = true;
        await hardnessType.save();

        res.status(200).json(
            new ApiResponse(200, hardnessType, "Hardness type soft deleted successfully !")
        );
    }
);

// ===================== Hardness Measurement =====================

export const createHardnessMeasurement = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { name, description } = req.body;

        if (!name || name.trim() === "") {
            throw new ApiError(400, "Hardness measurement name is required");
        }

        const existing = await HardnessMeasurement.findOne({ name, isDeleted: false });

        if (existing) {
            throw new ApiError(400, "Hardness measurement already exists");
        }

        const hardnessMeasurement = await HardnessMeasurement.create({
            name,
            description: description ?? "",
        });

        res.status(201).json(
            new ApiResponse(201, hardnessMeasurement, "Hardness measurement created successfully !")
        );
    }
);

export const getAllHardnessMeasurements = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const page = parseInt(req.query.page as string) || 1;
        const size = parseInt(req.query.size as string) || 10;
        const search = (req.query.search as string) || "";
        const sortBy = (req.query.sortBy as string) || "createdAt";
        const sortOrder = (req.query.sortOrder as string) === "asc" ? 1 : -1;

        const filter: Record<string, unknown> = { isDeleted: false };
        if (search) {
            filter.name = { $regex: search, $options: "i" };
        }

        const totalCount = await HardnessMeasurement.countDocuments(filter);
        const hardnessMeasurements = await HardnessMeasurement.find(filter)
            .sort({ [sortBy]: sortOrder })
            .skip((page - 1) * size)
            .limit(size);

        res.status(200).json(
            new ApiResponse(200, {
                data: hardnessMeasurements,
                totalCount,
                page,
                size,
                totalPages: Math.ceil(totalCount / size),
            }, "Hardness measurements fetched successfully !")
        );
    }
);

export const updateHardnessMeasurement = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;
        const { name, description } = req.body;

        const hardnessMeasurement = await HardnessMeasurement.findOne({
            _id: id,
            isDeleted: false,
        });

        if (!hardnessMeasurement) {
            throw new ApiError(404, "Hardness measurement not found");
        }

        if (name !== undefined) hardnessMeasurement.name = name;
        if (description !== undefined) hardnessMeasurement.description = description;

        await hardnessMeasurement.save();

        res.status(200).json(
            new ApiResponse(200, hardnessMeasurement, "Hardness measurement updated successfully !")
        );
    }
);

export const deleteHardnessMeasurement = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params;

        const hardnessMeasurement = await HardnessMeasurement.findOne({
            _id: id,
            isDeleted: false,
        });

        if (!hardnessMeasurement) {
            throw new ApiError(404, "Hardness measurement not found");
        }

        hardnessMeasurement.isDeleted = true;
        await hardnessMeasurement.save();

        res.status(200).json(
            new ApiResponse(
                200,
                hardnessMeasurement,
                "Hardness measurement soft deleted successfully !"
            )
        );
    }
);
