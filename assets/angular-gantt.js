/*
 Project: Gantt chart for Angular.js
 Author: Marco Schweighauser (2013)
 License: MIT License. See README.md
 */

var gantt = angular.module('gantt', []);

gantt.directive('gantt', ['Gantt', 'dateFunctions', function (Gantt, df) {
    return {
        restrict: "EA",
        replace: true,
        templateUrl: function (tElement, tAttrs) {
            if (tAttrs.templateUrl === undefined) {
                return "template/gantt.tmpl.html";
            } else {
                return tAttrs.templateUrl;
            }
        },
        scope: {
            viewScale: "=?", // Possible scales: 'hour', 'day'
            viewScaleFactor: "=?", // How wide are the columns, 1 being 1em per unit (hour or day depending on scale),
            sortMode: "=?", // Possible modes: 'name', 'date', 'custom'
            taskPrecision: "=?", // Defines how precise tasks should be positioned. 4 = in quarter steps, 2 = in half steps, ... Use values higher than 24 or 60 (hour view) to display them very accurate. Default (4)
            autoExpand: "=?", // Set this true if the date range shall expand if the user scroll to the left or right end.
            fromDate: "=?", // If not specified will use the earliest task date (note: as of now this can only expand not shrink)
            toDate: "=?", // If not specified will use the latest task date (note: as of now this can only expand not shrink)
            firstDayOfWeek: "=?", // 0=Sunday, 1=Monday, ... Default (1)
            weekendDays: "=?", // Array of days: 0=Sunday, 1=Monday, ... Default ([0,6])
            showWeekends: "=?", // True if the weekends shall be displayed Default (true)
            workHours: "=?", // Array of valid work hours. Default ([8,9,..,16] equals a 8am - 17pm workday)
            showNonWorkHours: "=?", // True if the non work hours shall be displayed Default (true)
            maxHeight: "=?", // Define the maximum height of the Gantt in PX. > 0 to activate max height behaviour.
            data: "=?",
            loadData: "&",
            removeData: "&",
            clearData: "&",
            onGanttReady: "&",
            onRowAdded: "&",
            onRowClicked: "&",
            onRowUpdated: "&",
            onScroll: "&",
            onTaskClicked: "&"
        },
        controller: ['$scope', '$element', '$timeout', function ($scope, $element, $timeout) {
            // Initialize defaults
            if ($scope.autoExpand === undefined) $scope.autoExpand = false;
            if ($scope.sortMode === undefined) $scope.sortMode = "name";
            if ($scope.viewScale === undefined) $scope.viewScale = "day";
            if ($scope.viewScaleFactor === undefined) $scope.viewScaleFactor = 0.1;
            if ($scope.taskPrecision === undefined) $scope.taskPrecision = 4;
            if ($scope.firstDayOfWeek === undefined) $scope.firstDayOfWeek = 1;
            if ($scope.maxHeight === undefined) $scope.maxHeight = 0;
            if ($scope.weekendDays === undefined) $scope.weekendDays = [0,6];
            if ($scope.showWeekends === undefined) $scope.showWeekends = true;
            if ($scope.workHours === undefined) $scope.workHours = [8,9,10,11,12,13,14,15,16];
            if ($scope.showNonWorkHours === undefined) $scope.showNonWorkHours = true;
            $scope.ganttInnerWidth = 0;

            // Gantt logic
            $scope.gantt = new Gantt($scope.viewScale, $scope.weekendDays, $scope.showWeekends, $scope.workHours, $scope.showNonWorkHours);

            // Swaps two rows and changes the sort order to custom to display the swapped rows
            $scope.swapRows = function (a, b) {
                $scope.gantt.swapRows(a, b);

                // Raise change events
                $scope.raiseRowUpdated(a);
                $scope.raiseRowUpdated(b);

                // Switch to custom sort mode and trigger sort
                if ($scope.sortMode !== "custom") {
                    $scope.sortMode = "custom"; // Sort will be triggered by the watcher
                } else {
                    $scope.sortRows();
                }
            };

            // Sort rows by the current sort mode
            $scope.sortRows = function () {
                $scope.gantt.sortRows($scope.sortMode);
            };

            $scope.$watch("sortMode", function (newValue, oldValue) {
                if (!angular.equals(newValue, oldValue)) {
                    $scope.sortRows();
                }
            });

            $scope.$watch("data", function (newValue, oldValue) {
                if (!angular.equals(newValue, oldValue)) {
                    $scope.removeAllData();
                    $scope.setData(newValue);
                }
            });

            // Add a watcher if a view related setting changed from outside of the Gantt. Update the grid accordingly if so.
            $scope.$watch('viewScaleFactor+firstDayOfWeek', function(newValue, oldValue) {
                if (!angular.equals(newValue, oldValue)) {
                    $scope.updateBounds();
                }
            });

            // Add a watcher if a view related setting changed from outside of the Gantt. Update the grid accordingly if so.
            // Those changes need a recalculation of the header columns
            $scope.$watch('viewScale+weekendDays+showWeekends+workHours+showNonWorkHours', function(newValue, oldValue) {
                if (!angular.equals(newValue, oldValue)) {
                    $scope.gantt.weekendDays = $scope.weekendDays;
                    $scope.gantt.showWeekends = $scope.showWeekends;
                    $scope.gantt.workHours = $scope.workHours;
                    $scope.gantt.showNonWorkHours = $scope.showNonWorkHours;
                    $scope.gantt.setViewScale($scope.viewScale);
                    $scope.gantt.reGenerateColumns();
                    $scope.updateBounds();
                }
            });

            // Update all task and column bounds.
            $scope.updateBounds = function() {
                var i, l;

                $scope.updateColumnBounds();

                for (i = 0, l = $scope.gantt.rows.length; i < l; i++) {
                    var row = $scope.gantt.rows[i];
                    for (var j = 0, k = row.tasks.length; j < k; j++) {
                        $scope.updateTaskBounds(row.tasks[j]);
                    }
                }

                var last = $scope.gantt.getLastColumn();
                $scope.ganttInnerWidth = last !== null ? last.left + last.width: 0;
            };

            // Calculate the bounds of a task and publishes it as properties
            $scope.updateTaskBounds = function(task) {
                var cmp =  function(c) { return c.date; };
                var cFrom = $scope.calcClosestColumns(task.from, cmp);
                var cTo = $scope.calcClosestColumns(task.to, cmp);

                // Task bounds are calculated according to their time
                task.left = calculateTaskPos(cFrom[0], task.from);
                task.width = Math.round( (calculateTaskPos(cTo[0], task.to) - task.left) * 10) / 10;

                // Set minimal width
                if (task.width === 0) {
                    task.width = cFrom[0].width / $scope.taskPrecision;
                }
            };

            // Calculates the position of the task start or end
            // The position is based on the column which is closest to the start (or end) date.
            // This column has a width which is used to calculate the exact position within this column.
            var calculateTaskPos = function(column, date) {
                return Math.round( (column.left + column.width * getTaskPrecisionFactor(date, $scope.taskPrecision)) * 10) / 10;
            };

            // Returns the position factor of a task between two columns.
            // Use the precision parameter to specify if task shall be displayed e.g. in quarter steps
            // precision: 4 = in quarter steps, 2 = in half steps, ..
            var getTaskPrecisionFactor = function(date, precision) {
                return $scope.viewScale === "hour" ? Math.round(date.getMinutes()/60 * precision) / precision : Math.round(date.getHours()/24 * precision) / precision;
            };

            // Calculate the bounds of a column and publishes it as properties
            $scope.updateColumnBounds = function() {
                var i, l, left = 0;

                for (i = 0, l = $scope.gantt.columns.length; i < l; i++) {
                    var column = $scope.gantt.columns[i];

                    column.width = $scope.viewScaleFactor;
                    column.left = left;
                    left = Math.round((left + column.width) * 10) / 10;
                }

                /*var i, l, left = 0;
                var currentDay = -1, currentWeek = -1, currentMonth = -1;

                for (i = 0, l = $scope.gantt.columns.hours.length; i < l; i++) {
                    var hourColumn = $scope.gantt.columns.hours[i];

                    // Possible enhancement: Column may have different width if weekend or non work hour
                    hourColumn.width = $scope.viewScaleFactor;
                    hourColumn.left = left;
                    left = Math.round((left + hourColumn.width) * 10) / 10;

                    // Set day column left and width (if not already)
                    currentDay = setColumnBound($scope.gantt.columns.days, currentDay, hourColumn.width, currentDay > -1 ? $scope.gantt.columns.days[currentDay].date.getDate() !== hourColumn.date.getDate(): true);

                    // Set month column left and width (if not already)
                    currentWeek = setColumnBound($scope.gantt.columns.weeks, currentWeek, hourColumn.width, currentWeek > -1 ? $scope.gantt.columns.weeks[currentWeek].week !== df.getWeek(hourColumn.date): true);

                    // Set month column left and width (if not already)
                    currentMonth = setColumnBound($scope.gantt.columns.months, currentMonth, hourColumn.width, currentMonth > -1 ? $scope.gantt.columns.months[currentMonth].date.getMonth() !== hourColumn.date.getMonth(): true);
                }*/
            };

            var setColumnBound = function(cols, curIndex, width, goToNextCol) {
                var col = cols[curIndex];
                if (col === undefined || goToNextCol) {
                    curIndex += 1;
                    col = cols[curIndex];
                    col.left = Math.round((curIndex > 0 ? cols[curIndex-1].left + cols[curIndex-1].width: 0)*10)/10;
                    col.width = width;
                } else {
                    col.width = Math.round((col.width + width) * 10)/10;
                }

                return curIndex;
            };

            // Expands the date area when the user scroll to either left or right end.
            // May be used for the write mode in the future.
            $scope.autoExpandColumns = function(el, date, direction) {
                if ($scope.autoExpand !== true) {
                    return;
                }

                var from, to;
                var expandHour = 1, expandDay = 30;

                if (direction === "left") {
                    from = $scope.viewScale === "hour" ? df.addDays(date, -expandHour, true) : df.addDays(date, -expandDay, true);
                    to = date;
                } else {
                    from = date;
                    to =  $scope.viewScale === "hour" ? df.addDays(date, expandHour, true) : df.addDays(date, expandDay, true);
                }

                var oldScrollLeft = el.scrollLeft === 0 ? ((to - from) * el.scrollWidth) / ($scope.gantt.columns.getLast().date - $scope.gantt.columns.getFirst().date) : el.scrollLeft;
                $scope.gantt.expandColumns(from, to);
                $scope.updateBounds();

                // Show Gantt at the same position as it was before expanding the date area
                el.scrollLeft = oldScrollLeft;
            };

            $scope.raiseRowAdded = function(row) {
                $scope.onRowAdded({ event: { row: row.clone() } });
            };

            // Return the column on the left and right using the given cmp function.
            // The compare function defined which property of the column to compare to x (e.g.: c => c.left)
            $scope.calcClosestColumns = function(x, cmp) {
                var a = $scope.gantt.columns;

                var lo = -1, hi = a.length;
                while (hi - lo > 1) {
                    var mid = Math.floor((lo + hi)/2);
                    if (cmp(a[mid]) <= x) {
                        lo = mid;
                    } else {
                        hi = mid;
                    }
                }
                if (a[lo] !== undefined && cmp(a[lo]) === x) hi = lo;
                return [a[lo], a[hi]];
            };

            // Support for lesser browsers (read IE 8)
            $scope.getOffset = function getOffset(evt) {
                if(evt.layerX && evt.layerY) {
                    return {x: evt.layerX, y: evt.layerY};
                }
                else {
                    var el = evt.target, x,y;
                    x=y=0;
                    while (el && !isNaN(el.offsetLeft) && !isNaN(el.offsetTop)) {
                        x += el.offsetLeft - el.scrollLeft;
                        y += el.offsetTop - el.scrollTop;
                        el = el.offsetParent;
                    }
                    x = evt.clientX - x;
                    y = evt.clientY - y;
                    return { x: x, y: y };
                }
            };

            $scope.raiseRowClicked = function(e, row) {
                var emPxFactor = $scope.ganttScroll.children()[0].offsetWidth / $scope.ganttInnerWidth;
                var clickedColumn = $scope.calcClosestColumns($scope.getOffset(e).x / emPxFactor, function(c) { return c.left; })[0];
                $scope.onRowClicked({ event: { row: row.clone(), column: clickedColumn.clone(), date: df.clone(clickedColumn.date) } });

                e.stopPropagation();
                e.preventDefault();
            };

            $scope.raiseRowUpdated = function(row) {
                $scope.onRowUpdated({ event: { row: row.clone() } });
            };

            $scope.raiseScrollEvent = function() {
                var el = $scope.ganttScroll[0];
                var direction;
                var column;

                if (el.scrollLeft === 0) {
                    direction = 'left';
                    column = $scope.gantt.getFirstColumn();
                } else if (el.offsetWidth + el.scrollLeft >= el.scrollWidth) {
                    direction = 'right';
                    column = $scope.gantt.getLastColumn();
                }

                if (column !== undefined) {
                    // Timeout is a workaround to because of the horizontal scroll wheel problem on OSX.
                    // It seems that there is a scroll momentum which will continue the scroll when we add new data
                    // left or right of the Gantt directly in the scroll event.
                    // => Tips how to improve this are appreciated :)
                    $timeout(function() {
                        var date = df.clone(column.date);
                        $scope.autoExpandColumns(el, date, direction);
                        $scope.onScroll({ event: { date: date, direction: direction }});
                    }, 500, true);
                }
            };

            $scope.raiseTaskClicked = function(e, row, task) {
                var rClone = row.clone();

                $scope.onTaskClicked({ event: {row: rClone, task: rClone.tasksMap[task.id] } });

                e.stopPropagation();
                e.preventDefault();
            };

            // Clear all existing rows and tasks
            $scope.removeAllData = function() {
                $scope.gantt.removeRows();
                $scope.updateBounds();
            };

            // Bind scroll event
            $scope.ganttScroll = angular.element($element.children()[2]);
            $scope.ganttScroll.bind('scroll', $scope.raiseScrollEvent);
            $scope.setData = function (data) {
                var el = $scope.ganttScroll[0];
                var oldDateRange = $scope.gantt.columns.length > 0 ? $scope.gantt.getLastColumn().date - $scope.gantt.getFirstColumn().date : 1;
                var oldWidth = el.scrollWidth;

                for (var i = 0, l = data.length; i < l; i++) {
                    var rowData = data[i];
                    var isUpdate = $scope.gantt.addRow(rowData);
                    var row = $scope.gantt.rowsMap[rowData.id];

                    if (isUpdate === true) {
                        $scope.raiseRowUpdated(row);
                    } else {
                        $scope.raiseRowAdded(row);
                    }
                }

                // This currently will only expand the range it doesn't have the ability to "shrink" it at this point
                if($scope.fromDate || $scope.toDate) {
                    var firstDate = $scope.fromDate ? $scope.fromDate : $scope.gantt.getFirstColumn().date;
                    var lastDate =  $scope.toDate ? $scope.toDate : $scope.gantt.getLastColumn().date;

                    if (firstDate !== undefined && lastDate !== undefined) {
                        $scope.gantt.expandColumns(firstDate, lastDate);
                    }
                }

                $scope.updateBounds();
                $scope.sortRows();

                // Show Gantt at the same position as it was before adding the new data
                el.scrollLeft = el.scrollLeft === 0 && $scope.gantt.columns.length > 0 ? (($scope.gantt.getLastColumn().date - $scope.gantt.getFirstColumn().date) * oldWidth) / oldDateRange - oldWidth : el.scrollLeft;
            };

            // Load data handler.
            // The Gantt chart will keep the current view position if this function is called during scrolling.
            $scope.loadData({ fn: $scope.setData});

            // Remove data handler.
            // If a row has no tasks inside the complete row will be deleted.
            $scope.removeData({ fn: function(data) {
                for (var i = 0, l = data.length; i < l; i++) {
                    var rowData = data[i];

                    if (rowData.tasks !== undefined && rowData.tasks.length > 0) {
                        // Only delete the specified tasks but not the row and the other tasks

                        if (rowData.id in $scope.gantt.rowsMap) {
                            var row = $scope.gantt.rowsMap[rowData.id];

                            for (var j = 0, k = rowData.tasks.length; j < k; j++) {
                                row.removeTask(rowData.tasks[j].id);
                            }

                            $scope.raiseRowUpdated(row);
                        }
                    } else {
                        // Delete the complete row
                        $scope.gantt.removeRow(rowData.id);
                    }
                }

                $scope.updateBounds();
                $scope.sortRows();
            }});

            // Clear data handler.
            $scope.clearData({ fn: $scope.removeAllData});

            // Gantt is initialized. Signal that the Gantt is ready.
            $scope.onGanttReady();
        }
    ]};
}]);
;gantt.factory('Column', [ function () {
    // Used to display the Gantt header.
    // The columns are generated by the logic code and the position/width by the directive.

    var Column = function(date) {
        var self = this;
        self.date = date;
        self.left = 0;
        self.width = 0;
        self.clone = function() {
            var copy = new Column(self.date);
            copy.left = self.left;
            copy.width = self.width;
            return copy;
        };
        self.equals = function(other) {
            return self.date === other.date;
        };
    };

    var WeekColumn = function(date, week) {
        var column = new Column(date);
        column.week = week;
        column.clone = function() {
            var copy = new Column(self.date);
            copy.left = column.left;
            copy.width = column.width;
            copy.week = column.week;
            return copy;
        };
        return column;
    };

    var DayColumn = function(date, isWeekend) {
        var column = new Column(date);
        column.isWeekend = isWeekend;
        column.clone = function() {
            var copy = new Column(self.date);
            copy.left = column.left;
            copy.width = column.width;
            copy.isWeekend = column.isWeekend;
            return copy;
        };
        return column;
    };

    var HourColumn = function(date, isWeekend, isWorkHour) {
        var column = new Column(date);
        column.isWeekend = isWeekend;
        column.isWorkHour = isWorkHour;
        column.clone = function() {
            var copy = new Column(self.date);
            copy.left = column.left;
            copy.width = column.width;
            copy.isWeekend = column.isWeekend;
            copy.isWorkHour = column.isWorkHour;
            return copy;
        };
        return column;
    };

    return {
        Hour: HourColumn,
        Day: DayColumn,
        Week: WeekColumn,
        Month: Column,
        Year: Column
    };
}]);;gantt.factory('ColumnGenerator', [ 'Column', 'dateFunctions', function (Column, df) {

    // Returns true if the given day is a weekend day
    var checkIsWeekend = function(weekendDays, day) {
        for (var i = 0, l = weekendDays.length; i < l; i++) {
            if (weekendDays[i] === day) {
                return true;
            }
        }

        return false;
    };

    // Returns true if the given hour is a work hour
    var checkIsWorkHour = function(workHours, hour) {
        for (var i = 0, l = workHours.length; i < l; i++) {
            if (workHours[i] === hour) {
                return true;
            }
        }

        return false;
    };


    var HourColumnGenerator = function(workHours, showNonWorkHours, showWeekends, weekendDays) {
        this.generate = function(from, to) {
            from = df.setTimeZero(from, true);
            to = df.setTimeZero(to, true);

            var date = df.clone(from);
            var generatedCols = [];

            while(to - date >= 0) {
                var isWeekend = checkIsWeekend(weekendDays, date.getDay());

                for (var i = 0; i<24; i++) {
                    var cDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), i, 0, 0);
                    var isWorkHour = checkIsWorkHour(workHours, i);

                    if ((isWeekend && showWeekends || !isWeekend) && (!isWorkHour && showNonWorkHours || isWorkHour)) {
                        generatedCols.push(new Column.Hour(cDate, isWeekend, isWorkHour));
                    }
                }

                date = df.addDays(date, 1);
            }

            return generatedCols;
        };
    };

    var DayColumnGenerator = function(showWeekends, weekendDays) {
        this.generate = function(from, to) {
            from = df.setTimeZero(from, true);
            to = df.setTimeZero(to, true);

            var date = df.clone(from);
            var generatedCols = [];

            while(to - date >= 0) {
                var isWeekend = checkIsWeekend(weekendDays, date.getDay());

                if (isWeekend && showWeekends || !isWeekend) {
                    generatedCols.push(new Column.Day(df.clone(date), isWeekend));
                }

                date = df.addDays(date, 1);
            }

            return generatedCols;
        };
    };

    var WeekColumnGenerator = function(firstDayOfWeek) {
        this.generate = function(from, to) {
            from = df.setToDayOfWeek(df.setTimeZero(from, true), firstDayOfWeek, false);
            to = df.setToDayOfWeek(df.setTimeZero(to, true), firstDayOfWeek, false);

            var date = df.clone(from);
            var generatedCols = [];

            while(to - date >= 0) {
                generatedCols.push(new Column.Month(df.clone(date)));

                date = df.addWeeks(date, 1);
            }

            return generatedCols;
        };
    };

    var MonthColumnGenerator = function() {
        this.generate = function(from, to) {
            from = df.setToFirstDayOfMonth(df.setTimeZero(from, true), false);
            to = df.setToFirstDayOfMonth(df.setTimeZero(to, true), false);

            var date = df.clone(from);
            var generatedCols = [];

            while(to - date >= 0) {
                generatedCols.push(new Column.Month(df.clone(date)));

                date = df.addMonths(date, 1);
            }

            return generatedCols;
        };
    };

    return {
        HourGenerator: HourColumnGenerator,
        DayGenerator: DayColumnGenerator,
        WeekGenerator: WeekColumnGenerator,
        MonthGenerator: MonthColumnGenerator
    };
}]);;gantt.service('dateFunctions', [ function () {
    // Date calculations from: http://www.datejs.com/ | MIT License
    return {
        firstDayOfWeek: 1,
        isNumber: function(n) { return !isNaN(parseFloat(n)) && isFinite(n); },
        isString: function(o) { return typeof o == "string" || (typeof o == "object" && o.constructor === String);},
        clone: function(date) {
            if (this.isString(date)) {
                return new Date(Date.parse(date));
            } else if (this.isNumber(date)) {
                return new Date(date);
            } else {
                return new Date(date.getTime());
            }
        },
        setTimeZero: function(date, clone) {
            var res = clone === true ? this.clone(date) : date;
            res.setHours(0);
            res.setMinutes(0);
            res.setMilliseconds(0);
            return res;
        },
        setToFirstDayOfMonth: function(date, clone) {
            var res = clone === true ? this.clone(date) : date;
            res.setDate(1);
            return res;
        },
        setToDayOfWeek: function(date, dayOfWeek, clone) {
            var res = clone === true ? this.clone(date) : date;
            if (res.getDay() === dayOfWeek) {
                return res;
            } else {
                var orient = -1;
                var diff = (dayOfWeek - res.getDay() + 7 * (orient || +1)) % 7;
                return this.addDays(res, (diff === 0) ? diff += 7 * (orient || +1) : diff);
            }
        },
        addMonths: function(date, val, clone) {
            var res = clone === true ? this.clone(date) : date;
            res.setDate(1);
            res.setMonth(res.getMonth() + val);
            return res;
        },
        addWeeks: function(date, val, clone) {
            var res = clone === true ? this.clone(date) : date;
            res.setDate(res.getDate() + val * 7);
            return res;
        },
        addDays: function(date, val, clone) {
            var res = clone === true ? this.clone(date) : date;
            res.setDate(res.getDate() + val);
            return res;
        },
        addHours: function(date, val, clone) {
            var res = clone === true ? this.clone(date) : date;
            res.setHours(res.getHours() + val);
            return res;
        },
        addMinutes: function(date, val, clone) {
            var res = clone === true ? this.clone(date) : date;
            res.setMinutes(res.getMinutes() + val);
            return res;
        },
        addMilliseconds: function(date, val, clone) {
            var res = clone === true ? this.clone(date) : date;
            res.setMilliseconds(res.getMilliseconds() + val);
            return res;
        },
        getWeek: function(date) {
            /* Returns the number of the week. The number is calculated according to ISO 8106 */
            var $y, $m, $d;
            var a, b, c, d, e, f, g, n, s, w;

            $y = date.getFullYear();
            $m = date.getMonth() + 1;
            $d = date.getDate();

            if ($m <= 2) {
                a = $y - 1;
                b = (a / 4 | 0) - (a / 100 | 0) + (a / 400 | 0);
                c = ((a - 1) / 4 | 0) - ((a - 1) / 100 | 0) + ((a - 1) / 400 | 0);
                s = b - c;
                e = 0;
                f = $d - 1 + (31 * ($m - 1));
            } else {
                a = $y;
                b = (a / 4 | 0) - (a / 100 | 0) + (a / 400 | 0);
                c = ((a - 1) / 4 | 0) - ((a - 1) / 100 | 0) + ((a - 1) / 400 | 0);
                s = b - c;
                e = s + 1;
                f = $d + ((153 * ($m - 3) + 2) / 5) + 58 + s;
            }

            g = (a + b) % 7;
            d = (f + g - e) % 7;
            n = (f + 3 - d) | 0;

            if (n < 0) {
                w = 53 - ((g - s) / 5 | 0);
            } else if (n > 364 + s) {
                w = 1;
            } else {
                w = (n / 7 | 0) + 1;
            }

            $y = $m = $d = null;

            return w;
        }
    };
}]);;gantt.factory('Gantt', ['Row', 'ColumnGenerator', 'dateFunctions', function (Row, ColumnGenerator, df) {

    // Gantt logic. Manages the columns, rows and sorting functionality.
    var Gantt = function(viewScale, weekendDays, showWeekends, workHours, showNonWorkHours) {
        var self = this;

        self.rowsMap = {};
        self.rows = [];
        self.columns = [];
        self.highestRowOrder = 0;
        self.weekendDays = weekendDays;
        self.showWeekends = showWeekends;
        self.workHours = workHours;
        self.showNonWorkHours = showNonWorkHours;

        // TODO:
        // Calculate columns (most detailed level which is visible in Gantt, e.g. days)
        // Make lowest header level same as gantt columns
        // Calculate all other header based on the columns

        self.setViewScale = function(viewScale) {
            switch(viewScale) {
                case "hour": self.columnGenerator = new ColumnGenerator.HourGenerator(workHours, showNonWorkHours, weekendDays, showWeekends); break;
                case "day": self.columnGenerator = new ColumnGenerator.DayGenerator(weekendDays, showWeekends); break;
                case "week": self.columnGenerator = new ColumnGenerator.WeekGenerator(1); break; // TODO day of week must be dynamic
                case "month": self.columnGenerator = new ColumnGenerator.MonthGenerator(); break;
                default:
                    throw "Unsupported view scale: " + viewScale;
            }
        };

        self.setViewScale(viewScale);

        // Generates the Gantt columns according to the specified from - to date range. Uses the currently assigned column generator.
        self.expandColumns = function(from, to) {
            // Only expand if expand is necessary
            if (self.columns.length === 0) {
                self.columns = self.columnGenerator.generate(from, to);
            } else if (self.getFirstColumn().date > from || self.getLastColumn().date < to) {
                var minFrom = self.getFirstColumn().date > from ? from: self.getFirstColumn().date;
                var maxTo = self.getLastColumn().date < to ? to: self.getLastColumn().date;

                self.columns = self.columnGenerator.generate(minFrom, maxTo);
            }
        };

        self.getLastColumn = function() {
            if (self.columns.length > 0) {
                return self.columns[self.columns.length-1];
            } else {
                return null;
            }
        };

        self.getFirstColumn = function() {
            if (self.columns.length > 0) {
                return self.columns[0];
            } else {
                return null;
            }
        };

        // Removes all existing columns and re-generates them
        self.reGenerateColumns = function() {
            var from = self.getFirstColumn().date;
            var to = self.getLastColumn().date;

            self.columns = [];
            if (from !== undefined && to !== undefined) {
                self.expandColumns(from, to);
            }
        };

        // Adds a row to the list of rows. Merges the row and it tasks if there is already one with the same id
        self.addRow = function(rowData) {
            // Copy to new row (add) or merge with existing (update)
            var row, isUpdate = false;

            if (rowData.id in self.rowsMap) {
                row = self.rowsMap[rowData.id];
                row.copy(rowData);
                isUpdate = true;
            } else {
                var order = rowData.order;

                // Check if the row has a order predefined. If not assign one
                if (order === undefined) {
                    order = self.highestRowOrder;
                }

                if (order >= self.highestRowOrder) {
                    self.highestRowOrder = order + 1;
                }

                row = new Row(rowData.id, rowData.description, order, rowData.data);
                self.rowsMap[rowData.id] = row;
                self.rows.push(row);
            }

            if (rowData.tasks !== undefined) {
                for (var i = 0, l = rowData.tasks.length; i < l; i++) {
                    var task = row.addTask(rowData.tasks[i]);
                    self.expandColumns(task.from, task.to);
                }
            }

            return isUpdate;
        };

        // Removes the complete row including all tasks
        self.removeRow = function(rowId) {
            if (rowId in self.rowsMap) {
                delete self.rowsMap[rowId]; // Remove from map

                for (var i = 0, l = self.rows.length; i < l; i++) {
                    var row = self.rows[i];
                    if (row.id === rowId) {
                        self.rows.splice(i, 1); // Remove from array
                        return row;
                    }
                }
            }
        };

        // Removes all rows and tasks
        self.removeRows = function() {
            self.rowsMap = {};
            self.rows = [];
            self.highestRowOrder = 0;
            self.columns = new EmptyColumns();
        };

        // Swaps two rows and changes the sort order to custom to display the swapped rows
        self.swapRows = function (a, b) {
            // Swap the two rows
            var order = a.order;
            a.order = b.order;
            b.order = order;
        };

        // Sort helper to sort by the date of the task with the earliest from date.
        // Rows with no min date will be sorted by name
        var sortByDate = function (a, b) {
            if (a.minFromDate === undefined && b.minFromDate === undefined) {
                return sortByName(a, b);
            } else if (a.minFromDate === undefined) {
                return 1;
            } else if (b.minFromDate === undefined) {
                return -1;
            } else {
                return a.minFromDate - b.minFromDate;
            }
        };

        // Sort helper to sort by description name
        var sortByName = function (a, b) {
            if (a.description === b.description) {
                return 0;
            } else {
                return (a.description < b.description) ? -1 : 1;
            }
        };

        // Sort helper to sort by order.
        // If a row has no order move it at the end. If both rows have no order they will be sorted by name.
        var sortByCustom = function (a, b) {
            if (a.order === undefined && b.order === undefined) {
                return sortByName(a, b);
            } else if (a.order === undefined) {
                return 1;
            } else if (b.order === undefined) {
                return -1;
            } else {
                return a.order - b.order;
            }
        };

        // Sort rows by the specified sort mode (name, order, custom)
        self.sortRows = function (mode) {
            switch (mode) {
                case "name":
                    self.rows.sort(sortByName);
                    break;
                case "custom":
                    self.rows.sort(sortByCustom);
                    break;
                default:
                    self.rows.sort(sortByDate);
                    break;
            }
        };
    };

    return Gantt;
}]);;gantt.factory('Row', ['Task', 'dateFunctions', function (Task, df) {
    var Row = function(id, description, order, data) {
        var self = this;

        self.id = id;
        self.description = description;
        self.order= order;
        self.tasksMap = {};
        self.tasks = [];
        self.data = data;

        // Adds a task to a specific row. Merges the task if there is already one with the same id
        self.addTask = function(taskData) {
            // Copy to new task (add) or merge with existing (update)
            var task;

            if (taskData.id in self.tasksMap) {
                task = self.tasksMap[taskData.id];
                task.copy(taskData);
            } else {
                task = new Task(taskData.id, taskData.subject, taskData.color, taskData.from, taskData.to, taskData.data);
                self.tasksMap[taskData.id] = task;
                self.tasks.push(task);
            }

            self.findEarliestFromDate(task);
            return task;
        };

        // Remove the specified task from the row
        self.removeTask = function(taskId) {
            if (taskId in self.tasksMap) {
                delete self.tasksMap[taskId]; // Remove from map

                for (var i = 0, l = self.tasks.length; i < l; i++) {
                    var task = self.tasks[i];
                    if (task.id === taskId) {
                        self.tasks.splice(i, 1); // Remove from array

                        // Update earliest date info as this may change
                        if (self.minFromDate - task.from === 0) {
                            self.minFromDate = undefined;
                            for (var j = 0, k = self.tasks.length; j < k; j++) {
                                self.findEarliestFromDate(self.tasks[j]);
                            }
                        }

                        return task;
                    }
                }
            }
        };

        // Calculate the earliest from date of all tasks in a row
        self.findEarliestFromDate = function (task) {
            if (self.minFromDate === undefined) {
                self.minFromDate = df.clone(task.from);
            } else if (task.from < self.minFromDate) {
                self.minFromDate = df.clone(task.from);
            }
        };

        self.copy = function(row) {
            self.description = row.description;
            self.data = row.data;

            if (row.order !== undefined) {
                self.order = row.order;
            }
        };

        self.clone = function() {
            var clone = new Row(self.id, self.description, self.order, self.data);
            for (var i = 0, l = self.tasks.length; i < l; i++) {
                clone.addTask(self.tasks[i].clone());
            }

            return clone;
        };
    };

    return Row;
}]);;gantt.factory('Task', ['dateFunctions', function (df) {
    var Task = function(id, subject, color, from, to, data) {
        var self = this;

        self.id = id;
        self.subject = subject;
        self.color = color;
        self.from = df.clone(from);
        self.to = df.clone(to);
        self.data = data;

        self.copy = function(task) {
            self.subject = task.subject;
            self.color = task.color;
            self.from = df.clone(task.from);
            self.to = df.clone(task.to);
            self.data = task.data;
        };

        self.clone = function() {
            return new Task(self.id, self.subject, self.color, self.from, self.to, self.data);
        };
    };

    return Task;
}]);;gantt.filter('ganttColumnLimit', [function () {
    // Returns only the columns which are visible on the screen

    var calcClosestIndex = function(a, x) {
        var lo = -1, hi = a.length;
        while (hi - lo > 1) {
            var mid = Math.floor((lo + hi)/2);
            if (a[mid].left <= x) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        if (a[lo] !== undefined && a[lo].left === x) hi = lo;
        return [lo, hi];
    };

     return function(input, scroll_left, scroll_width, show) {
         if (show === true) {
            return [];
         }

        var start = calcClosestIndex(input, scroll_left)[0];
        var end = calcClosestIndex(input, scroll_left + scroll_width)[1];
        return input.slice(start, end);
    };
}]);;gantt.filter('ganttDateWeek', ['dateFunctions', function (df) {
    return function (date) {
        return df.getWeek(date);
    };
}]);;gantt.directive('ganttHorizontalScrollReceiver', ['scroller', function (scroller) {
    // The element with this attribute will scroll at the same time as the scrollSender element

    return {
        restrict: "A",
        controller: ['$scope', '$element', function ($scope, $element) {
            scroller.horizontal.push($element[0]);
        }]
    };
}]);;gantt.directive('ganttLimitUpdater', ['$timeout', function ($timeout) {
    return {
        restrict: "A",
        controller: ['$scope', '$element', function ($scope, $element) {
            var el = $element[0];
            var update = function() {
                var emPxFactor = $scope.ganttScroll.children()[0].offsetWidth / $scope.ganttInnerWidth;
                $scope.scroll_start = el.scrollLeft / emPxFactor;
                $scope.scroll_width = el.offsetWidth / emPxFactor;
            };

            $element.bind('scroll', function() { $scope.$apply(function() { update(); }); });

            $scope.$watch('ganttInnerWidth', function(newValue, oldValue) {
                $timeout(function() {
                    update();
                }, 20, true);
            });
        }]
    };
}]);;gantt.directive('ganttScrollSender', ['scroller', '$timeout', function (scroller, $timeout) {
    // Updates the element which are registered for the horizontal or vertical scroll event

    return {
        restrict: "A",
        controller: ['$scope', '$element', function ($scope, $element) {
            var el = $element[0];
            var updateListeners = function() {
                var i, l;

                for (i = 0, l = scroller.vertical.length; i < l; i++) {
                    var vElement = scroller.vertical[i];
                    if (vElement.style.top !== -el.scrollTop)
                        vElement.style.top = -el.scrollTop + 'px';
                }

                for (i = 0, l = scroller.horizontal.length; i < l; i++) {
                    var hElement = scroller.horizontal[i];
                    if (hElement.style.left !== -el.scrollLeft)
                        hElement.style.left = -el.scrollLeft + 'px';
                }
            };

            $element.bind('scroll', updateListeners);

            $scope.$watch('ganttInnerWidth', function(newValue, oldValue) {
                if (newValue === 0) {
                    $timeout(function() {
                        updateListeners();
                    }, 20, true);
                }
            });
        }]
    };
}]);;gantt.service('scroller', [ function () {
    return { vertical: [], horizontal: [] };
}]);;gantt.directive('ganttSortable', ['$document', 'sortableState', function ($document, sortableState) {
    // Provides the row sort functionality to any Gantt row
    // Uses the sortableState to share the current row

    return {
        restrict: "E",
        template: "<div ng-transclude></div>",
        replace: true,
        transclude: true,
        scope: { row: "=ngModel", swap: "&" },
        controller: ['$scope', '$element', function ($scope, $element) {
            $element.bind("mousedown", function () {
                enableDragMode();

                var disableHandler = function () {
                    angular.element($document[0].body).unbind('mouseup', disableHandler);
                    disableDragMode();
                };
                angular.element($document[0].body).bind("mouseup", disableHandler);
            });

            $element.bind("mousemove", function (e) {
                if (isInDragMode()) {
                    var elementBelowMouse = angular.element($document[0].elementFromPoint(e.clientX, e.clientY));
                    var targetRow = elementBelowMouse.controller("ngModel").$modelValue;

                    $scope.$apply(function() {
                        $scope.swap({a: targetRow, b: sortableState.startRow});
                    });
                }
            });

            var isInDragMode = function () {
                return sortableState.startRow !== undefined && !angular.equals($scope.row, sortableState.startRow);
            };

            var enableDragMode = function () {
                sortableState.startRow = $scope.row;
                $element.css("cursor", "move");
                angular.element($document[0].body).css({
                    '-moz-user-select': '-moz-none',
                    '-webkit-user-select': 'none',
                    '-ms-user-select': 'none',
                    'user-select': 'none',
                    'cursor': 'no-drop'
                });
            };

            var disableDragMode = function () {
                sortableState.startRow = undefined;
                $element.css("cursor", "pointer");
                angular.element($document[0].body).css({
                    '-moz-user-select': '',
                    '-webkit-user-select': '',
                    '-ms-user-select': '',
                    'user-select': '',
                    'cursor': 'auto'
                });
            };
        }]
    };
}]);;gantt.service('sortableState', [ function () {
    // Contains the row which the user wants to sort (the one he started to drag)

    return { startRow: undefined };
}]);;gantt.filter('ganttTaskLimit', [function () {
    // Returns only the tasks which are visible on the screen
    // Use the task width and position to decide if a task is still visible

    return function(input, scroll_left, scroll_width) {
        var res = [];
        for(var i = 0, l = input.length; i<l; i++) {
            var task = input[i];
            // If task has a visible part on the screen
            if (task.left >= scroll_left && task.left <= scroll_left + scroll_width ||
                task.left + task.width >= scroll_left && task.left + task.width <= scroll_left + scroll_width ||
                task.left < scroll_left && task.left + task.width > scroll_left + scroll_width) {
                    res.push(task);
            }
        }

        return res;
    };
}]);;gantt.directive('ganttTooltip', ['dateFilter', '$timeout', '$document', function (dateFilter, $timeout, $document) {
    // This tooltip displays more information about a task

    return {
        restrict: "E",
        template: "<div ng-mouseenter='mouseEnter($event)' ng-mouseleave='mouseLeave($event)'>" +
            "<div ng-show='visible' class='gantt-task-info' ng-style='css'>" +
            "<div class='gantt-task-info-content'>" +
            "{{ task.subject }}</br>" +
            "<small>" +
            "{{ task.to - task.from === 0 &&" +
            " (task.from | date:'MMM d, HH:mm') ||" +
            " (task.from | date:'MMM d, HH:mm') + ' - ' + (task.to | date:'MMM d, HH:mm') }}" +
            "</small>" +
            "</div>" +
            "</div>" +
            "<div ng-transclude></div>" +
            "</div>",
        replace: true,
        transclude: true,
        scope: { task: "=ngModel" },
        controller: ['$scope', '$element', function ($scope, $element) {
            $scope.visible = false;
            $scope.css = {};

            $scope.mouseEnter = function (e) {
                $scope.visible = true;

                $timeout(function(){
                    var elTip = angular.element($element.children()[0]);

                    elTip.removeClass('gantt-task-infoArrow');
                    elTip.removeClass('gantt-task-infoArrowR');

                    // Check if info is overlapping with view port
                    if (e.clientX + elTip[0].offsetWidth > $scope.getViewPortWidth()) {
                        $scope.css.left = (e.clientX + 20 - elTip[0].offsetWidth) + "px";
                        elTip.addClass('gantt-task-infoArrowR'); // Right aligned info
                    } else {
                        $scope.css.left = (e.clientX - 20) + "px";
                        elTip.addClass('gantt-task-infoArrow');
                    }
                    $scope.css.top = $element[0].getBoundingClientRect().top + "px";
                    $scope.css.marginTop = -elTip[0].offsetHeight - 8 + "px";
                    $scope.css.opacity = 1;
                },1, true);
            };

            $scope.mouseLeave = function () {
                $scope.css.opacity = 0;
                $scope.visible = false;
            };

            $scope.getViewPortWidth = function() {
                var d = $document[0];
                return d.documentElement.clientWidth || d.documentElement.getElementById('body')[0].clientWidth;
            };
        }]
    };
}]);;gantt.directive('ganttVerticalScrollReceiver', ['scroller', function (scroller) {
    // The element with this attribute will scroll at the same time as the scrollSender element

    return {
        restrict: "A",
        controller: ['$scope', '$element', function ($scope, $element) {
            scroller.vertical.push($element[0]);
        }]
    };
}]);