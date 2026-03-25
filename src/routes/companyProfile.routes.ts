import { Router } from "express";
import {
    getCompanyProfile,
    updateCompanyProfile,
    uploadCompanyLogo,
} from "../controller/companyProfile.controller";
import { verifyJWT } from "../middlewares/auth.middleware";
import { upload } from "../middlewares/multer.middleware";

const router = Router();
router.use(verifyJWT);

router.get("/", getCompanyProfile);
router.put("/", updateCompanyProfile);
router.post("/logo", upload.single("logo"), uploadCompanyLogo);

export default router;
