/*global rally, document, moment */

String.prototype.capFirst = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
};

var iterDropdown;
var rallyDataSource;

function OpenStoriesTasksAndDefects() { // eslint-disable-line no-unused-vars
    var that = this;

    var busySpinner;
    var defectTable, storyTable;
    var abbrev = { 'HierarchicalRequirement': 'ar', 'Defect': 'df', 'Task': 'tk', 'TestCase': 'tc' };

    var blankStoryRow = {
        itemLink: '<div style="min-height:49px">&nbsp</div>',
        'status': '<div style="min-height:49px">&nbsp</div>',
        blocked: '<div style="min-height:49px">&nbsp</div>',
        userName: '<div style="min-height:49px">&nbsp</div>',
    };

    function indentedItem(content/*, color*/) {
        var indentationDiv = '<div style="margin-left: 20px;">' + content + '</div>';
        return indentationDiv;
    }

    function getDaysInProgress(artifact) {
        var rv = '',
            now = new Date();
        if (artifact.ScheduleState === 'In-Progress' && artifact.InProgressDate) {
            rv = ((now.getTime() - new Date(artifact.InProgressDate).getTime()) / 1000 / 60 / 60 / 24 ).toFixed(0);
        }
        return rv;
    }

    function ownerIfKnown(arti) {
        var owner = '',
            hasDisplay = false;

        if (arti.Owner) {
            if (arti.Owner.DisplayName) {
                owner = arti.Owner.DisplayName;
                hasDisplay = true;
            }
            else if (arti.Owner.UserName) {
                owner = arti.Owner.UserName;
            }
        }

        if (! hasDisplay) {
            var firstLastNameEmail = owner.match(/([^.]+)\.([^.]+)@.*/);

            if (firstLastNameEmail) {
                owner = firstLastNameEmail[2].capFirst() + ', ' + firstLastNameEmail[1].capFirst();
            }

            var firstInitialEmail = owner.match(/(.)(.+)@/);

            if (firstInitialEmail) {
                owner = firstInitialEmail[1].capFirst() + '. ' + firstInitialEmail[2].capFirst();
            }
        }

        return owner;
    }

    function artifactLink(artifact, namePrefix) {
        var artUrl = '__SERVER_URL__/detail/_ABBREV_/_OID_';
        artUrl = artUrl.replace('_ABBREV_', abbrev[artifact._type]);
        artUrl = artUrl.replace('_OID_', artifact.ObjectID);
        var linkText = artifact.FormattedID + ' ' + artifact.Name;
        if (namePrefix) {
            linkText = namePrefix + linkText;
        }
        var link = '<a href="_URL_" target="_blank">_TEXT_</a>';
        link = link.replace('_URL_', artUrl);
        link = link.replace('_TEXT_', linkText);
        return link;
    }
    function getCustomer(defect) {
        if (defect.IsCustomer) {
            return 'Yes';
        }
        return '';
    }
    function getPriority(item) {
        var rv = '';
        if (item.Priority !== 'None') {
            rv = item.Priority;
        }
        return getMaxString(rv, 5);
    }
    function getRelease(item) {
        var rv = '';
        if (item.Release) {
            rv = item.Release.Name;
        }
        return rv;
    }
    function getMaxString(str, max) {
        var rv = str.substring(0, max);
        if (rv !== str) {
            rv += '...';
        }
        return rv;
    }

    function getBlockedHtml(item) {
        var rv = '';
        if (item.Blocked) {
            if (item.BlockedReason && item.BlockedReason.match(/pr/i)) {
                rv = item.BlockedReason;
            }
            else {
                rv = item.BlockedReason;
                if (! rv) {
                    rv = 'Blocked';
                }
            }

            rv = getMaxString(rv, 25);
            rv = '<b style="color:red">' + rv + '</b>';
        }
        return rv;
    }
    var firstDisplay = true;
    function displayChild(item, tableData, tableInfo, parentInfo) {
        if (item.State === 'Completed' || item.ScheduleState === 'Completed' || item.ScheduleState === 'Accepted') {
            if (item.Blocked) {
                if (parentInfo && ! parentInfo.displayed) {
                    if (! firstDisplay) {
                        tableData.push(blankStoryRow);
                    }
                    tableData.push(parentInfo);
                    parentInfo.displayed = true;
                    firstDisplay = false;
                }
                tableData.push(tableInfo);
                return true;
            }
        }
        else {
            if (parentInfo && ! parentInfo.displayed) {
                if (! firstDisplay) {
                    tableData.push(blankStoryRow);
                }
                tableData.push(parentInfo);
                parentInfo.displayed = true;
                firstDisplay = false;
            }
            tableData.push(tableInfo);
            return true;
        }
        return false;
    }

    function storySort(left, rite) {
        return left.FormattedID.localeCompare(rite.FormattedID);
    }

    function itemSort(left, rite) {
        var computedValue = function(item) {
            var rv = 0;

            if (item.State === 'Completed' || item.ScheduleState === 'Completed') {
                rv += 1000;

                if (! item.Blocked) {
                    rv += 100;
                }
            }
            else if (item.State === 'In-Progress' || item.ScheduleState === 'In-Progress') {
                rv += 2000;

                if (! item.Blocked) {
                    rv += 100;
                }
            }
            else {
                rv += 3000;
                if (item.Blocked) {
                    rv += 100;
                }
            }

            if (item.Priority === 'Immediate') { rv += 10; }
            else if (item.Priority === 'High') { rv += 20; }
            else if (item.Priority === 'Normal') { rv += 30; }
            else if (item.Priority === 'Low') { rv += 40; }
            else { rv += 50; }

            return rv;
        };

        var rv = computedValue(left) - computedValue(rite);
        if (rv === 0) {
                var leftOwner = ownerIfKnown(left),
                    riteOwner = ownerIfKnown(rite);
                rv = leftOwner.localeCompare(riteOwner);

            if (rv === 0) {
                if (left.TaskIndex && rite.TaskIndex) {
                    rv = left.TaskIndex - rite.TaskIndex;
                }
                else if (left.Rank && rite.Rank) {
                    rv = left.Rank - rite.Rank;
                }

                if (rv === 0) {
                    rv = left.FormattedID.localeCompare(rite.FormattedID);
                }
            }
        }
        return rv;
    }

    function showStories(stories, contentDiv) {
        var storyLink, storyInfo;
        var taskLink, taskInfo, indentedTask;
        var defectLink, defectInfo, indentedDefect;
        var tableData = [];
        var tblConfig, emptyStory;
        var taskData = {
            def: 0,
            ip: 0,
            compPR: 0,
            comp: 0
        };
        var usPoints = 0;

        stories.sort(storySort).forEach(function(story) {
            if (story._type === 'HierarchicalRequirement') {
                usPoints += story.PlanEstimate;
                story.Tasks.forEach(function(task) {
                    if (task.State === 'Defined') {
                        taskData.def += 1;
                    }
                    else if (task.State === 'In-Progress') {
                        taskData.ip += 1;
                    }
                    else if (task.State === 'Completed') {
                        if (task.BlockedReason && task.BlockedReason === 'PR') {
                            taskData.compPR += 1;
                        }
                        else {
                            taskData.comp += 1;
                        }
                    }
                 });
            }

            var storyOwner = ownerIfKnown(story),
                statusDays = getDaysInProgress(story);

            if (statusDays !== '') {
                statusDays += ' Days';
            }

            emptyStory = true;
            storyLink = artifactLink(story);
            storyInfo = {
                'itemLink': '<div class="story-name">' + storyLink + '</div>',
                'status': statusDays,
                'blocked': '',
                'userName': '<div class="story-owner">' + storyOwner + '</div>'
            };

            story.Tasks.sort(itemSort).forEach(function(task) {
                emptyStory = false;
                taskLink = artifactLink(task);
                indentedTask = indentedItem(taskLink);
                taskInfo = {
                    'itemLink': indentedTask,
                    'status': task.State,
                    'blocked': getBlockedHtml(task),
                    'userName': ownerIfKnown(task)
                };

                displayChild(task, tableData, taskInfo, storyInfo);
            });

            if (story.Defects) {
                story.Defects.sort(itemSort).forEach(function(defect) {
                    emptyStory = false;
                    defectLink = artifactLink(defect);
                    indentedDefect = indentedItem(defectLink);
                    defectInfo = {
                        'itemLink': indentedDefect,
                        'status': defect.ScheduleState,
                        'blocked': getBlockedHtml(defect),
                        'userName': ownerIfKnown(defect)
                    };

                    displayChild(defect, tableData, defectInfo, storyInfo);
                });
            }

            if (emptyStory) {
                tableData.push(blankStoryRow);
                tableData.push(storyInfo);
            }

        });
        tblConfig = {
            'columnKeys': ['itemLink', 'status', 'blocked', 'userName'],
            'columnHeaders': ['Artifact', 'Status', 'Blocked', 'Owner'   ],
            'columnWidths': ['800px', '100px', '100px', '200px'   ],
            'sortingEnabled': false
        };

        storyTable = new rally.sdk.ui.Table(tblConfig);
        storyTable.addRows(tableData);
        storyTable.display(contentDiv);

        document.getElementById('us-points').innerHTML = usPoints;

        document.getElementById('task-def').innerHTML = taskData.def;
        document.getElementById('task-ip').innerHTML = taskData.ip;
        document.getElementById('task-comp-pr').innerHTML = taskData.compPR;
        document.getElementById('task-comp').innerHTML = taskData.comp;
    }

    function getCreated(item) {
//         gets pretty format of age i.e 3 Months Age
//         return moment(new Date(item.CreationDate)).fromNow();
        return moment(new Date()).diff(new Date(item.CreationDate), 'days');
    }

    function showDefects(defects, contentDiv) {
        var tableData = [];
        var tblConfig;
        var defectLink, defectInfo;
        var defPoints = 0;
        var age = 0;
        var defCount = 0;
        var now = new Date();

        var in_progress = [ 0, 0, 0 ],
            defined = [ 0, 0, 0 ],
            comp_pr = 0;

        defects.sort(itemSort).forEach(function(defect) {
            var pref = defect.Tasks.length === 0 ? '' : '*** ';
            if (defect.Requirement) {
                pref += '<b>[' + defect.Requirement.FormattedID + ']</b> ';
            }

            defectLink = artifactLink(defect, pref);
            defectInfo = { 'defectLink': defectLink,
                'status': defect.ScheduleState,
                'priority': getPriority(defect),
                'release': getRelease(defect),
                'blocked': getBlockedHtml(defect),
                'created': getCreated(defect),
                'customer': getCustomer(defect),
                'userName': ownerIfKnown(defect)
            };

            if (defect.ScheduleState === 'Completed' && defect.BlockedReason === 'PR') {
                comp_pr += 1;
            }

            if (defect.ScheduleState === 'In-Progress') {
                if (defect.Priority === 'Low') {
                    in_progress[0] += 1;
                }
                else if (defect.Priority === 'High') {
                    in_progress[2] += 1;
                }
                else {
                    in_progress[1] += 1;
                }
            }

            if (defect.ScheduleState === 'Defined') {
                if (defect.Priority === 'Low') {
                    defined[0] += 1;
                }
                else if (defect.Priority === 'High') {
                    defined[2] += 1;
                }
                else {
                    defined[1] += 1;
                }
            }

            defectInfo.daysInProgress = getDaysInProgress(defect);

            var didDisplay = displayChild(defect, tableData, defectInfo);

            if (didDisplay) {
                defPoints += defect.PlanEstimate;

                age += now.getTime() - new Date(defect.CreationDate).getTime();
                defCount++;
            }
        });
        tblConfig = {
            'columnKeys': ['release', 'created', 'defectLink', 'customer', 'priority', /*'daysInProgress',*/ 'status', 'blocked', 'userName'],
            'columnHeaders': ['Release', 'Age (Days)', 'Defect', 'Customer', 'Priority', /*'Days IP',*/ 'Status', 'Blocked', 'Owner'   ],
            'columnWidths': ['75px', '75px', '700px', '60', '60', /*'50',*/ '100px', '100px', '100px'   ]
        };

        defectTable = new rally.sdk.ui.Table(tblConfig);
        defectTable.addRows(tableData);
        defectTable.display(contentDiv);

        document.getElementById('def-comp-pr').innerHTML = comp_pr;

        document.getElementById('def-ip-high').innerHTML = in_progress[2];
        document.getElementById('def-ip-low').innerHTML = in_progress[0];
        document.getElementById('def-ip-other').innerHTML = in_progress[1];

        document.getElementById('def-defined-high').innerHTML = defined[2];
        document.getElementById('def-defined-low').innerHTML = defined[0];
        document.getElementById('def-defined-other').innerHTML = defined[1];

        document.getElementById('def-points').innerHTML = Number(defPoints).toFixed(1);

        document.getElementById('def-avg-age').innerHTML = (age / defCount / 1000 / 60 / 60 / 24 ).toFixed(1);
    }

    function showResults(results) {
        if (busySpinner) {
            busySpinner.hide();
            busySpinner = null;
        }

        // defects with tasks will be listed with the user stories
        var ownedStories = results.stories.concat(results.defects.filter(function(defect) {
            return defect.Tasks.length > 0;
        }));

        showStories(ownedStories, 'stories');

        // defects with no tasks will be listed separately from defects with tasks
        var ownedDefects = results.defects.filter(function(defect) {
            return true; //defect.Tasks.length === 0;
        });

        showDefects(ownedDefects, 'defects');
    }

    that.onIterationSelected = function() {
        var targetIterationName = iterDropdown.getSelectedName();
        var iterCond = '(Iteration.Name = "_ITER_TARGET_")'.replace('_ITER_TARGET_', targetIterationName);
        var scheduleStateCondition = '(ScheduleState != "Accepted")';
        var storyCriteria = '(' + iterCond + ' AND ' + scheduleStateCondition + ')';
        var defectCriteria = '(' + iterCond + ' AND ' + scheduleStateCondition + ')';
        var queryConfigs = [];
        var hrColumns = [
            'Blocked',
            'BlockedReason',
            'CreationDate',
            'Defects',
            'DisplayName',
            'FormattedID',
            'InProgressDate',
            'Name',
            'ObjectID',
            'Owner',
            'PlanEstimate',
            'Priority',
            'Rank',
            'Release',
            'Requirement',
            'ScheduleState',
            'State',
            'TaskIndex',
            'Tasks',
            'UserName'
        ];

        var defectColumns = hrColumns.concat('IsCustomer');

        queryConfigs[0] = {
            type: 'hierarchicalrequirement',
            key: 'stories',
            fetch: hrColumns.join(','),
            query: storyCriteria
        };
        queryConfigs[1] = {
            type: 'defect',
            key: 'defects',
            fetch: defectColumns.join(','),
            query: defectCriteria
        };
        busySpinner = new rally.sdk.ui.basic.Wait({});
        busySpinner.display('wait');

        if (storyTable) {
            storyTable.destroy();
            storyTable = null;
        }
        if (defectTable) {
            defectTable.destroy();
            defectTable = null;
        }

        rallyDataSource.setApiVersion('1.43');
        rallyDataSource.findAll(queryConfigs, showResults);
    };
}
