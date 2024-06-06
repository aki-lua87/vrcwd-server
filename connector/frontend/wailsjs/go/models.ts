export namespace main {
	
	export class Setting {
	    id: string;
	    title: string;
	    details: string;
	    target: string;
	    type: string;
	    url: string;
	    regexp: string;
	
	    static createFrom(source: any = {}) {
	        return new Setting(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.details = source["details"];
	        this.target = source["target"];
	        this.type = source["type"];
	        this.url = source["url"];
	        this.regexp = source["regexp"];
	    }
	}
	export class SaveData {
	    path: string;
	    settings: Setting[];
	
	    static createFrom(source: any = {}) {
	        return new SaveData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.settings = this.convertValues(source["settings"], Setting);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

