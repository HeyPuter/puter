-- Copyright (C) 2024-present Puter Technologies Inc.
--
-- This file is part of Puter.
--
-- Puter is free software: you can redistribute it and/or modify
-- it under the terms of the GNU Affero General Public License as published
-- by the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
-- GNU Affero General Public License for more details.
--
-- You should have received a copy of the GNU Affero General Public License
-- along with this program.  If not, see <https://www.gnu.org/licenses/>.

INSERT INTO `apps`
    (`uid`, `owner_user_id`, `icon`, `name`, `title`, `description`, `godmode`, `maximize_on_start`, `index_url`, `approved_for_listing`, `approved_for_opening_items`, `approved_for_incentive_program`, `timestamp`, `last_review`, `tags`, `app_owner`)
VALUES
    ('app-2e8a0e1f-7c3b-4d6a-9f8e-1b5c0a2d3e4f', 1, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAFd0lEQVR42u3doW6VWxqA4XbSTE8zghCCwHEBdVQUNUehgMtANgSBqDkcU1lBHbcBuiGIE0TldlxAVQUkDUEx98BHZmXnfR7/7X/tP7tvllmruzuLnZ2d/Vy9BvhVp6enu6vXMPGv1QsA1hEACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACFt+lnl6H8CrV6+Wrv/k5GQ0/+7du9H81dXVaP7w8PC3v5Ntcn5+vvT5q+8TsAOAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAMAGAsL3VC9h2T58+Hc0/fPhw9Vdg4DfcRzG6D2N6n4AdAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAITtvXjxYnQeefr/7bfdZrNZvYStdnJyMpp/+/btaP709HTp/G8w+vu1A4AwAYAwAYAwAYAwAYAwAYAwAYAwAYAwAYAwAYAwAYAwAYAwAYAwAYAwAYCw3el9ANP/bz89T/3x48fR/PHx8Wh+/48/RvN/j6Z3dp5eXY3mDw8PR/Pn5+ej+dXn6a+G72+1o6Oj0bwdAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAIQJAITtTj/g7OxsdJ/A9Dz68+fPR/PT+wT+++efo/nV9wF8+DA7T/7XX7P17w5/gdPz/NPf32azmX2BIfcBAL9MACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBsfB/A3JvRfQI7O8MD6cNXcLXzYjT/YefdbPlvZuPbfp5/anofwNT0PgH3AQC/TAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgbG/1As7O/j2aPz39e7iCN6PpD9MD+cNx5/nXnuffdnYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAELb77Nmzn5MPePz48dIv8PXr19H8nTt3rH/g/fv3o/mLi4vR/LbfB7DZbEbzR0dHo3k7AAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAgTAAjbu729HX3AkydPRvPbfp576vPnz6P5b9++jean59EPDg5++zvh/8cOAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAML2Li8vdycf8Pr165+T+ZcvXy59AdfX16P5/f3/jOb/+efTaP7u3buj+U+fZs+/uLgYzbOWHQCECQCECQCECQCECQCECQCECQCECQCECQCECQCECQCECQCECQCECQCECQCE7a1ewPHx8dLn39zcjOa/fPkymn/06NHS9R8cHIzm2W52ABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABC2/D6AHz9+jObv37+/+iuMXF9fL33+9+/fV78CFrIDgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgLDl9wHs7+8vff70PoLb29vR/IMHD0bzNzc3o/mDg4PRPNvNDgDCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADClt8HwMy9e/dG85eXl6u/wshms1m9hK1mBwBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhAgBhu6sXsLOz83P1AqDKDgDCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADCBADC/gfl6qh2vMj28QAAAABJRU5ErkJggg==', 'jspaint', 'JS Paint', 'A browser-based MS Paint remake.', 0, 1, 'https://jspaint.app', 1, 1, 0, '2024-01-01 00:00:00', NULL, 'graphics,art', NULL);
