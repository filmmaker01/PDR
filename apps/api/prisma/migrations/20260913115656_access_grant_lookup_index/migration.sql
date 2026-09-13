-- CreateIndex
CREATE INDEX "access_grants_product_status_valid_until_idx" ON "access_grants"("product", "status", "valid_until");
