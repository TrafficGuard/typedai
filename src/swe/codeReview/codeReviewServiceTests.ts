import {CodeReviewService} from "#swe/codeReview/codeReviewService";
import sinon from "sinon";

export function runCodeReviewServiceTests(
    createService: () => CodeReviewService,
    beforeEachHook: () => Promise<void> | void = () => {},
    afterEachHook: () => Promise<void> | void = () => {},
) {

    let service: CodeReviewService;

    beforeEach(async () => {
        await beforeEachHook();
        service = createService();
    });

    afterEach(async () => {
        sinon.restore();
        await afterEachHook();
    });

}