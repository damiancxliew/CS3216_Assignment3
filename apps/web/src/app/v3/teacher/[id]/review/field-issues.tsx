"use client";

import { createContext, useContext } from "react";
import type { CheckIssue } from "@adventure/spec-v3";

const FieldIssues = createContext<CheckIssue[]>([]);
export const FieldIssueProvider = FieldIssues.Provider;
export const useFieldIssues = () => useContext(FieldIssues);
