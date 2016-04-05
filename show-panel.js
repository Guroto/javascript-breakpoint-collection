chrome.devtools.panels.create("Breakpoints",
    null,
    "panel.html",
    function(panel) {

      // code invoked on panel creation
    }
);

chrome.devtools.network.onNavigated.addListener(installBreakpointsObject)

installBreakpointsObject();

/*

run this code in the console for testing

window.a = {b: 5}
var id = breakpoints._debugObj(a, "b", {
    propertyGetBefore: function(){
        console.log("getting b")
    },
    propertySetAfter: function(){
        console.log("just set the value of a.b")
    },
    propertyCallBefore: function(){
        console.log("about to call a.b")
    },
    propertyCallAfter: function(){
        console.log("just called a.b")
    }
})

var id2 = breakpoints._debugObj(a, "b", {
    propertyGetBefore: function(){
        console.log("getting b (second handler)")
    }
})

window.a.b;
window.a.b = function(){
    console.log("inside the a.b function")
}
window.a.b();

breakpoints.reset(id)
breakpoints.reset(id2);
console.log("should only log one message between here...")
window.a.b();
console.log("...and here")

*/

function installBreakpointsObject(){


    chrome.devtools.inspectedWindow.eval(`
    (function(){

        var registry = new Map();
        var objectsAndPropsByDebugId = {}

        function debugObj(obj, prop, options) {
            var debugId = Math.floor(Math.random() * 100000000000).toString()
            objectsAndPropsByDebugId[debugId] = {
                obj,
                prop
            }

            if (registry.get(obj) === undefined) {
                registry.set(obj, {});
            }

            if (registry.get(obj)[prop] === undefined) {
                registry.get(obj)[prop] = {hooks: {}};

                var originalProp = getPropertyDescriptor(obj, prop);
                var isSimpleValue = "value" in originalProp; // rather than getter + setter

                Object.defineProperty(obj, prop, {
                    get: function(){
                        var retVal;
                        triggerHook("propertyGetBefore");
                        if (isSimpleValue) {
                            retVal = originalProp.value;
                        } else {
                            retVal = originalProp.get.apply(this, arguments);    
                        }
                        if (typeof retVal === "function") {
                            return function(){
                                triggerHook("propertyCallBefore")
                                retVal.apply(this, arguments);
                                triggerHook("propertyCallAfter")
                            }
                        }

                        triggerHook("propertyGetAfter");
                        return retVal;
                    },
                    set: function(newValue){
                        var retVal;
                        triggerHook("propertySetBefore")
                        if (isSimpleValue) {
                            retVal = originalProp.value = newValue;
                        } else {
                            retVal = originalProp.set.apply(this, arguments);
                        }
                        triggerHook("propertySetAfter")
                        return retVal;
                    }
                });
            }

            var hookNames = [
                "propertyGetBefore",
                "propertyGetAfter",
                "propertySetBefore",
                "propertySetAfter",
                "propertyCallBefore",
                "propertyCallAfter"
            ];
            hookNames.forEach(function(hookName){
                if (options[hookName] !== undefined) {
                    if (registry.get(obj)[prop].hooks[hookName] === undefined) {
                        registry.get(obj)[prop].hooks[hookName] = [];
                    }
                    registry.get(obj)[prop].hooks[hookName].push({
                        id: debugId,
                        fn: options[hookName]
                    })
                }
            });

            return debugId;

            function triggerHook(hookName) {
                var hooks = registry.get(obj)[prop].hooks;
                var hooksWithName = hooks[hookName];
                if (hooksWithName !== undefined && hooksWithName.length > 0) {
                    hooksWithName.forEach(function(hook){
                        hook.fn();
                    })
                }
            }
        }

        function resetDebug(id){
            var objAndProp = objectsAndPropsByDebugId[id];
            var hooks = registry.get(objAndProp.obj)[objAndProp.prop].hooks;
            for (var hookName in hooks) {
                var hooksWithName = hooks[hookName];
                hooks[hookName] = hooksWithName.filter(function(hook){
                    return hook.id !== id;
                })
            }

            delete objAndProp[id];
        }


        function debuggerFunction(){
            debugger;
        }
        
        function getPropertyDescriptor(object, propertyName){
            var descriptor = Object.getOwnPropertyDescriptor(object, propertyName);
            if (!object){
                throw new Error("Descriptor " + propertyName + " not found");
            }
            if (!descriptor) {
                return getPropertyDescriptor(Object.getPrototypeOf(object), propertyName);
            }
            return descriptor;
        }

        function debugPropertyAccess(object, prop, options){
            var before = options.before;
            var after = options.after;

            var originalProp = getPropertyDescriptor(object, prop);
            var isSimpleValue = "value" in originalProp; // rather than getter + setter

            Object.defineProperty(object, prop, {
                get: function(){
                    var retVal;
                    before("get");
                    if (isSimpleValue) {
                        retVal = originalProp.value;
                    } else {
                        retVal = originalProp.get.apply(this, arguments);    
                    }
                    after("get");
                    return retVal;
                },
                set: function(newValue){
                    var retVal;
                    before("set");
                    if (isSimpleValue) {
                        retVal = originalProp.value = newValue;
                    } else {
                        retVal = originalProp.set.apply(this, arguments);
                    }
                    after("set");
                    return retVal;
                }
            });
        }

        function createPropertyAccessTypeDebugFunction(accessTypeToDebug) {
            return function(object, prop, options){
                var before, after;
                if (options === undefined) {
                    before = debuggerFunction;
                }
                else {
                    before = options.before;
                    after = options.after;
                }
                debugPropertyAccess(object, prop, {
                    before: function(accessType){
                        if (accessTypeToDebug === accessType) {
                            if (before) {
                                before.apply(this, arguments)
                            }
                        }
                    },
                    after: function(accessType){
                        if (accessTypeToDebug === accessType) {
                            if (after) {
                                after.apply(this, arguments)
                            }
                        }
                    }
                })
            }
        }

        function debugCall(object, prop, options){
            var before, after;
            if (options === undefined) {
                before = debuggerFunction;
            } else if (typeof options === "function") {
                before = options;
            } else {
                before = options.before;
                after = options.after;
            }

            var originalFunction = object[prop];
            object[prop] = function(){
                if (before) {
                    before();
                }
                var retVal = originalFunction();
                if (after) {
                    after();
                }
                return retVal
            }
        }

        window.breakpoints = {
            debugPropertyAccess,
            debugPropertyGet: createPropertyAccessTypeDebugFunction("get"),
            debugPropertySet: createPropertyAccessTypeDebugFunction("set"),
            debugCall,
            reset: function(id){
                resetDebug(id);
            },
            _registry: registry,
            _debugObj: debugObj

        }
    })();
    `, function(){
        console.log("did eval", arguments)
    })
}