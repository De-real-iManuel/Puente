import { Router, type IRouter } from "express";
import healthRouter from "./health";
import fundingRouter from "./funding";
import paymentsRouter from "./payments";
import pollarRouter from "./pollar";
import payoutRouter from "./payout";
import receiptRouter from "./receipt";

const router: IRouter = Router();

router.use(healthRouter);
router.use(fundingRouter);
router.use(paymentsRouter);
router.use(pollarRouter);
router.use(payoutRouter);
router.use(receiptRouter);

export default router;
