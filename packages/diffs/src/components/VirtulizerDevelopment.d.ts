import { Virtualizer } from "./Virtualizer";
import { CodeView } from "./CodeView";

// FIXME(amadeus): REMOVE ME AFTER RELEASING VIRTUALIZATION
declare global {
	interface Window {
		// oxlint-disable-next-line typescript/no-explicit-any
		__INSTANCE?: CodeView<any> | Virtualizer;
		__TOGGLE?: () => void;
		__LOG?: boolean;
	}
}
