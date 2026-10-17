import { describeJobStore } from "@adventure/jobs/testing";
import { supabaseJobStore } from "@adventure/jobs";
import { serviceClient } from "./helpers";

describeJobStore("supabase", () => supabaseJobStore(serviceClient()));
