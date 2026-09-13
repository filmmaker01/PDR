-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_workspace_id_assignee_member_id_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_workspace_id_vehicle_id_fkey";

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_workspace_id_vehicle_id_fkey" FOREIGN KEY ("workspace_id", "vehicle_id") REFERENCES "vehicles"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_workspace_id_assignee_member_id_fkey" FOREIGN KEY ("workspace_id", "assignee_member_id") REFERENCES "workspace_members"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
